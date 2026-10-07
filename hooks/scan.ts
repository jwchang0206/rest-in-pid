import type { FsEntry, FsStat, ProcessRunInit, ProcessRunResult } from 'claude-code'

import type { Machine, Snapshot } from '../types'
import {
  bornOf,
  candidatesOf,
  classify,
  parseCwd,
  parseEnv,
  parseHost,
  parsePs,
  snapshotOf,
  tallyUsage,
  totalsOf,
  worktreeOf,
} from './model'
import type { HostEntry, Os, ProcEnv, PsRow, Tally } from './model'

/**
 * The session host this mod runs in, the user it runs as, the folder Claude Code keeps its
 * sessions and transcripts in, their system, and the machine.
 */
export type Context = { configDir: string; os: Os; selfUid: number; selfHostPid: number; machine: Machine }

/**
 * The host calls a scan makes. The engine only takes `$` spelled out at each
 * call site, so the hook that owns `$` hands these over as closures.
 */
export type Io = {
  run: (argv: readonly string[], init?: ProcessRunInit) => Promise<ProcessRunResult>
  exists: (path: string) => Promise<boolean>
  list: (path: string) => Promise<FsEntry[]>
  read: (path: string) => Promise<string>
  stat: (path: string) => Promise<FsStat>
  home: () => Promise<string | undefined>
  /** CLAUDE_CONFIG_DIR, which Claude Code uses in place of ~/.claude when it is set. */
  configDir: () => Promise<string | undefined>
  /** The settings Claude Code runs under, merged over every source. */
  settings: () => Promise<Readonly<Record<string, unknown>>>
  now: () => Promise<number>
}

/** A transcript counted so far: where it is, how many bytes were read, and what they added up to. */
type Reading = Tally & { path: string | null; offset: number; checkedAt: number }
export type Readings = Map<string, Reading>
/**
 * The session each process inherited, by pid, start time and command. `ps eww`
 * shows the environment a process started with, which only an exec replaces,
 * and an exec changes the command.
 */
export type Envs = Map<string, ProcEnv | null>

/** `ps` prints lstart in the local zone, while the session registry writes procStart in UTC. */
const UTC = { TZ: 'UTC', LC_ALL: 'C' }
/** The engine hands back this much of a command's output, and reads the rest only to drop it. */
const OUTPUT_CAP = 4_194_304
const SESSION_ID = /^[\w-]+$/
const MISSING_TRANSCRIPT_RETRY_MS = 60_000
const DAY_MS = 86_400_000
/** Claude Code's cleanupPeriodDays when no settings name one. */
const RETENTION_DAYS = 30
// ponytail: at most 8 x 4 MiB of a transcript per scan; a longer backlog finishes over the next scans.
const CHUNKS_PER_SCAN = 8
/** Linux: each pid, then the environment it started with, from /proc (what `ps eww` reads on macOS). */
const LINUX_ENVS = `for p; do printf '%s ' "$p"; tr '\\0\\n' '  ' < "/proc/$p/environ" 2>/dev/null; echo; done`
/** Linux: each pid's working folder from /proc, as the `p<pid>` and `n<path>` lines lsof prints. */
const LINUX_CWDS = `for p; do d=$(readlink "/proc/$p/cwd" 2>/dev/null) && printf 'p%s\\nn%s\\n' "$p" "$d"; done`

export async function contextOf(io: Io): Promise<Context> {
  const configDir = (await io.configDir()) || `${(await io.home()) ?? ''}/.claude`
  const { stdout } = await io.run(['/bin/sh', '-c', 'echo "$PPID $(id -u) $(uname -s)"'])
  const [host = '0', uid = '-1', system = ''] = stdout.trim().split(' ')
  const os = osOf(system)
  return { configDir, os, selfHostPid: Number(host), selfUid: Number(uid), machine: await machineOf(io, os) }
}

function osOf(system: string): Os {
  if (system === 'Darwin') return 'darwin'
  if (system === 'Linux') return 'linux'
  throw new Error(`Rest in PID reads macOS and Linux processes, not ${system || 'this system'}'s`)
}

/** The cores and memory the meters measure against; zeros when the probe fails. */
async function machineOf(io: Io, os: Os): Promise<Machine> {
  if (os === 'darwin') {
    const facts = await optional(io.run(['sysctl', '-n', 'hw.ncpu', 'hw.memsize']))
    const [cores = 0, memoryBytes = 0] = facts.trim().split('\n').map(Number)
    return { cores, memoryKb: Math.round(memoryBytes / 1024) }
  }
  const facts = await optional(io.run(['/bin/sh', '-c', 'getconf _NPROCESSORS_ONLN; grep MemTotal /proc/meminfo']))
  return { cores: Number(facts.split('\n')[0]) || 0, memoryKb: Number(/MemTotal:\s+(\d+)/.exec(facts)?.[1] ?? 0) }
}

/** procps takes BSD options only without the dash; macOS ps takes either. */
export async function readPs(io: Io, os: Os): Promise<PsRow[]> {
  const fields = 'pid=,ppid=,pgid=,uid=,stat=,%cpu=,rss=,lstart=,command='
  const argv = os === 'darwin' ? ['ps', '-axww', '-o', fields] : ['ps', 'axww', '-o', fields]
  const { stdout } = await io.run(argv, { env: UTC })
  return parsePs(stdout)
}

/** Output of a probe that may be missing or fail (lsof is not on every host); nothing then. */
async function optional(run: Promise<ProcessRunResult>): Promise<string> {
  try {
    return (await run).stdout
  } catch {
    return ''
  }
}

/**
 * The paths among `paths` that no longer exist. A path the host will not check
 * (it rejects a network location) counts as present, so it never makes a zombie.
 */
async function missing(io: Io, paths: ReadonlyArray<string | null>): Promise<Set<string>> {
  const gone = new Set<string>()
  for (const path of new Set(paths)) {
    if (path !== null && !(await io.exists(path).catch(() => true))) gone.add(path)
  }
  return gone
}

/**
 * Before when a shell snapshot may be gone while its session still runs: Claude Code's retention
 * sweep deletes the ones older than cleanupPeriodDays either way.
 */
async function sweptBefore(io: Io, now: number): Promise<number> {
  const settings = await io.settings().catch((): Readonly<Record<string, unknown>> => ({}))
  const days = settings.cleanupPeriodDays
  return now - (typeof days === 'number' && days >= 0 ? days : RETENTION_DAYS) * DAY_MS
}

async function readEntries(io: Io, configDir: string): Promise<HostEntry[]> {
  const dir = `${configDir}/sessions`
  if (!(await io.exists(dir))) return []
  const files = (await io.list(dir)).filter(file => file.kind === 'file' && file.name.endsWith('.json'))
  const entries = await Promise.all(files.map(async file => parseHost(await io.read(`${dir}/${file.name}`))))
  return entries.filter((entry): entry is HostEntry => entry !== null)
}

async function readingOf(io: Io, configDir: string, sessionId: string, readings: Readings) {
  const now = await io.now()
  let reading = readings.get(sessionId)
  if (reading === undefined || (reading.path === null && now - reading.checkedAt > MISSING_TRANSCRIPT_RETRY_MS)) {
    const found = await io.run([
      'find',
      `${configDir}/projects`,
      '-maxdepth',
      '2',
      '-name',
      `${sessionId}.jsonl`,
    ])
    reading = {
      path: found.stdout.split('\n')[0] || null,
      offset: 0,
      checkedAt: now,
      seen: new Set(),
      tokensIn: 0,
      tokensOut: 0,
    }
    readings.set(sessionId, reading)
  }
  if (reading.path === null) return reading
  const { size } = await io.stat(reading.path)
  if (size < reading.offset) Object.assign(reading, { offset: 0, seen: new Set(), tokensIn: 0, tokensOut: 0 })
  for (let chunk = 0; chunk < CHUNKS_PER_SCAN && reading.offset < size; chunk += 1) {
    // dd seeks to the offset and head stops at what the engine keeps: `tail -c +N` copies byte
    // by byte, and the engine would read the whole rest of the file every time.
    const { stdout } = await io.run([
      '/bin/sh',
      '-c',
      `{ dd bs=1 skip="$1" count=0 2>/dev/null; head -c ${OUTPUT_CAP}; } < "$2"`,
      'sh',
      String(reading.offset),
      reading.path,
    ])
    const end = stdout.lastIndexOf('\n')
    if (end < 0) break
    // Whole lines only: the byte count stays exact, and a cut line is read again next time.
    const lines = stdout.slice(0, end + 1)
    reading.offset += new TextEncoder().encode(lines).length
    tallyUsage(lines, reading)
  }
  return reading
}

const envKey = (row: PsRow): string => `${row.pid} ${row.started} ${row.command}`

/** The command that prints each pid followed by the environment it started with. */
const envProbe = (os: Os, pids: readonly string[]): string[] =>
  os === 'darwin'
    ? ['ps', 'eww', '-o', 'pid=,command=', '-p', pids.join(',')]
    : ['/bin/sh', '-c', LINUX_ENVS, 'sh', ...pids]

/** The command that prints each pid's working folder, as lsof's `p<pid>` and `n<path>` lines. */
const cwdProbe = (os: Os, pids: readonly string[]): string[] =>
  os === 'darwin'
    ? // -b skips the stat and readlink calls that can block (the kernel names the cwd either way).
      ['lsof', '-b', '-w', '-a', '-d', 'cwd', '-Fpn', '-p', pids.join(',')]
    : ['/bin/sh', '-c', LINUX_CWDS, 'sh', ...pids]

/**
 * The session each candidate inherited. Only the ones not read before are
 * asked about; a pid the probe did not print (gone, or the probe failed) is
 * asked again.
 */
async function readEnvs(
  io: Io,
  os: Os,
  rows: readonly PsRow[],
  candidates: ReadonlySet<number>,
  envs: Envs,
): Promise<Map<number, ProcEnv>> {
  const unread = rows.filter(row => candidates.has(row.pid) && !envs.has(envKey(row)))
  const pids = unread.map(row => String(row.pid))
  const stdout = pids.length === 0 ? '' : await optional(io.run(envProbe(os, pids)))
  const found = parseEnv(stdout, new Map(unread.map(row => [row.pid, row.command])))
  const printed = new Set(stdout.split('\n').map(line => Number(/^\s*(\d+)\s/.exec(line)?.[1])))
  const kept: Envs = new Map()
  const env = new Map<number, ProcEnv>()
  for (const row of rows) {
    const key = envKey(row)
    if (!candidates.has(row.pid) || (!envs.has(key) && !printed.has(row.pid))) continue
    const value = envs.has(key) ? (envs.get(key) ?? null) : (found.get(row.pid) ?? null)
    kept.set(key, value)
    if (value !== null) env.set(row.pid, value)
  }
  // Only the processes still running stay remembered.
  envs.clear()
  for (const [key, value] of kept) envs.set(key, value)
  return env
}

export async function scan(io: Io, context: Context, readings: Readings, envs: Envs): Promise<Snapshot> {
  const { os } = context
  const [rows, entries, swept] = await Promise.all([
    readPs(io, os),
    readEntries(io, context.configDir),
    io.now().then(now => sweptBefore(io, now)),
  ])
  const candidates = new Set(candidatesOf(rows, entries, context.selfUid, os))
  const pids = [...candidates].map(String)
  const [env, cwdOut] = await Promise.all([
    readEnvs(io, os, rows, candidates, envs),
    pids.length === 0 ? '' : optional(io.run(cwdProbe(os, pids))),
  ])
  const cwd = parseCwd(cwdOut)
  const { groups, zombies } = classify({
    rows,
    entries,
    env,
    cwd,
    missingWorktrees: await missing(io, [...cwd.values()].map(worktreeOf)),
    // Only a snapshot the retention sweep could not have taken says its session exited.
    missingSnapshots: await missing(
      io,
      rows
        .filter(row => candidates.has(row.pid))
        .map(row => snapshotOf(row.command))
        .map(snapshot => (snapshot !== null && bornOf(snapshot) >= swept ? snapshot : null)),
    ),
    selfUid: context.selfUid,
    os,
  })
  const sessions = [
    ...groups.map(group => group.session),
    ...zombies.flatMap(zombie => (zombie.session === null ? [] : [zombie.session])),
  ]
  for (const session of sessions) {
    if (!SESSION_ID.test(session.sessionId)) continue
    const reading = await readingOf(io, context.configDir, session.sessionId, readings).catch(() => undefined)
    session.tokensIn = reading?.tokensIn ?? 0
    session.tokensOut = reading?.tokensOut ?? 0
  }
  return {
    scannedAt: await io.now(),
    groups,
    zombies,
    totals: totalsOf(groups, zombies),
    machine: context.machine,
    error: null,
  }
}
