import type { Proc, Session, SessionGroup, Totals, Zombie, ZombieReason } from '../types'

export type PsRow = {
  pid: number
  ppid: number
  /** Process group: each Bash tool command's shell leads one, and its children stay in it. */
  pgid: number
  uid: number
  stat: string
  cpu: number
  rssKb: number
  /** lstart with its whitespace squashed; UTC when `ps` ran with TZ=UTC. */
  started: string
  command: string
}

/** A `~/.claude/sessions/<pid>.json` entry. The file can outlive a crashed session. */
export type HostEntry = {
  pid: number
  sessionId: string
  cwd: string
  name: string
  status: string
  procStart: string
}

/** What a process inherited from the Claude Code session that spawned it. */
export type ProcEnv = { claudePid: number; sessionId: string | null }

export type Scan = {
  rows: PsRow[]
  entries: HostEntry[]
  env: Map<number, ProcEnv>
  cwd: Map<number, string>
  missingWorktrees: Set<string>
  missingSnapshots: Set<string>
  selfUid: number
  os: Os
}

export type Tally = { seen: Set<string>; tokensIn: number; tokensOut: number }

type Guard = { selfUid: number; protectedPids: ReadonlySet<number> }

type Host = { pid: number; cwd: string; session: Session }
type Item = { row: PsRow; depth: number }
type Claim =
  | { kind: 'live'; hostPid: number }
  | { kind: 'zombie'; reason: ZombieReason; sessionId: string | null; dir: string }

/** The systems the mod reads. Windows has no ps, process groups or /proc. */
export type Os = 'darwin' | 'linux'

/**
 * What differs between the systems: which binaries are the OS's or an app's
 * (never a session's child, never ours to signal), whose environment the OS
 * hides, and who adopts an orphan.
 */
type Rules = { system: RegExp; hiddenEnv: RegExp | null; isReaper: (row: PsRow) => boolean }
const SYSTEMD_USER = /^\/(usr\/)?lib\/systemd\/systemd --user\b/
const RULES: Record<Os, Rules> = {
  darwin: {
    system: /^\/(System|Applications|Library|usr\/libexec|usr\/sbin|sbin)\//,
    // `ps eww` cannot read the environment of macOS's own binaries.
    hiddenEnv: /^\/(bin|usr\/bin)\//,
    // macOS has no subreapers: launchd adopts every orphan.
    isReaper: row => row.pid === 1,
  },
  linux: {
    system: /^\/(usr\/lib|usr\/libexec|usr\/share|usr\/sbin|sbin|lib|opt|snap)\//,
    // /proc/<pid>/environ is readable for every process of the same user.
    hiddenEnv: null,
    // An orphan goes to its nearest living subreaper, such as the user's systemd, or to init.
    isReaper: row => row.pid === 1 || SYSTEMD_USER.test(row.command),
  },
}

const PS_LINE =
  /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+(\d+)\s+(\w{3} \w{3}\s+\d+ [\d:]{8} \d{4})\s+(.*)$/
/** This mod's own probes, which run as children of the session hosting it. */
const PROBE =
  /^(ps -axww |ps axww |ps eww |lsof -b -w -a -d cwd |find \S+\/\.claude\/projects |\/bin\/kill |\/bin\/sh -c echo |\/bin\/sh -c getconf |\/bin\/sh -c for p; do |tr \\0\\n |readlink \/proc\/\d+\/cwd$|id -u|uname -s|sysctl -n |\/bin\/sh -c \{ dd bs=1 skip=|dd bs=1 skip=\d+ count=0$|head -c 4194304$)/
const WORKTREE = /^(.*?\/\.claude\/worktrees\/[^/]+)(?:\/|$)/
/**
 * A Bash tool shell, or a subshell it forked (which keeps its command line), sourcing its
 * session's shell snapshot. Claude Code deletes the snapshot when the session exits.
 */
const SNAPSHOT =
  /^\/\S*\/(?:zsh|bash|sh) -c source (\/\S+\/shell-snapshots\/snapshot-(?:zsh|bash|sh)-\d+-[a-z0-9]+(?:-[\w-]+)?\.sh) /
const COMMAND_MAX = 400

const squash = (text: string): string => text.trim().replace(/\s+/g, ' ')
const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
const textOf = (value: unknown): string => (typeof value === 'string' ? value : '')
const numberOf = (value: unknown): number => (typeof value === 'number' ? value : 0)
const sum = <T>(list: readonly T[], of: (item: T) => number): number =>
  list.reduce((total, item) => total + of(item), 0)

/** A Claude Code host: the desktop's bundled binary, a native `claude`, or the npm CLI. */
const isHostCommand = (command: string): boolean =>
  basename(squash(command.split(' -')[0] ?? '')) === 'claude' ||
  command.includes('@anthropic-ai/claude-code/cli')

const isCandidate = (row: PsRow, selfUid: number, rules: Rules): boolean =>
  row.pid > 1 && row.uid === selfUid && !rules.system.test(row.command) && !PROBE.test(row.command)

export function parsePs(stdout: string): PsRow[] {
  const rows: PsRow[] = []
  for (const line of stdout.split('\n')) {
    const match = PS_LINE.exec(line)
    if (match === null) continue
    const [, pid, ppid, pgid, uid, stat = '', cpu, rss, started = '', command = ''] = match
    rows.push({
      pid: Number(pid),
      ppid: Number(ppid),
      pgid: Number(pgid),
      uid: Number(uid),
      stat,
      cpu: Number(cpu),
      rssKb: Number(rss),
      started: squash(started),
      command,
    })
  }
  return rows
}

export function parseHost(json: string): HostEntry | null {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return null
  }
  if (!isRecord(value) || typeof value.pid !== 'number' || typeof value.sessionId !== 'string') {
    return null
  }
  return {
    pid: value.pid,
    sessionId: value.sessionId,
    cwd: textOf(value.cwd),
    name: textOf(value.name),
    status: textOf(value.status),
    procStart: squash(textOf(value.procStart)),
  }
}

/** `ps eww` output: each line is the pid, the command, then the environment it was started with. */
export function parseEnv(stdout: string): Map<number, ProcEnv> {
  const found = new Map<number, ProcEnv>()
  for (const line of stdout.split('\n')) {
    const pid = /^\s*(\d+)\s/.exec(line)?.[1]
    const claudePid = /\sCLAUDE_PID=(\d+)(?:\s|$)/.exec(line)?.[1]
    if (pid === undefined || claudePid === undefined) continue
    const sessionId = /\sCLAUDE_CODE_SESSION_ID=([\w-]+)(?:\s|$)/.exec(line)?.[1] ?? null
    found.set(Number(pid), { claudePid: Number(claudePid), sessionId })
  }
  return found
}

/** `lsof -Fpn` output: a `p<pid>` line, then an `n<path>` line for its cwd. */
export function parseCwd(stdout: string): Map<number, string> {
  const found = new Map<number, string>()
  let pid = 0
  for (const line of stdout.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    else if (line.startsWith('n') && pid > 0) found.set(pid, line.slice(1))
  }
  return found
}

/**
 * Adds each API response's usage once. A transcript writes one line per
 * content block, and every line of a response repeats the same usage.
 */
export function tallyUsage(lines: string, tally: Tally): void {
  for (const line of lines.split('\n')) {
    if (!line.includes('"usage"')) continue
    let row: unknown
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRecord(row) || row.type !== 'assistant' || !isRecord(row.message)) continue
    const { id, usage } = row.message
    if (typeof id !== 'string' || !isRecord(usage) || tally.seen.has(id)) continue
    tally.seen.add(id)
    tally.tokensIn +=
      numberOf(usage.input_tokens) +
      numberOf(usage.cache_creation_input_tokens) +
      numberOf(usage.cache_read_input_tokens)
    tally.tokensOut += numberOf(usage.output_tokens)
  }
}

export const worktreeOf = (path: string): string | null => WORKTREE.exec(path)?.[1] ?? null

export const snapshotOf = (command: string): string | null => SNAPSHOT.exec(command)?.[1] ?? null

function placeOf(path: string): string {
  const root = worktreeOf(path)
  if (root === null) return basename(path)
  const [repo = '', name = ''] = root.split('/.claude/worktrees/')
  return `${basename(repo)} › ${name}`
}

function labelOf(command: string): string {
  const label = command
    .split(' ')
    .filter(Boolean)
    .map(word => (word.includes('/') ? basename(word) || word : word))
    .join(' ')
  return label.length > 72 ? `${label.slice(0, 71)}…` : label
}

function toProc(row: PsRow, depth: number): Proc {
  return {
    pid: row.pid,
    ppid: row.ppid,
    started: row.started,
    command: row.command.slice(0, COMMAND_MAX),
    label: labelOf(row.command),
    cpu: row.cpu,
    rssKb: row.rssKb,
    isDefunct: row.stat.includes('Z'),
    depth,
  }
}

/**
 * The sessions running now. A registry entry vouches for its pid only while
 * the start time matches, so a reused pid never revives a dead session, and
 * wherever the binary was installed; a Claude Code process with no entry
 * still counts, so its children are never taken for orphans.
 */
function hostsOf(
  rows: readonly PsRow[],
  entries: readonly HostEntry[],
  selfUid: number,
  rules: Rules,
): Map<number, Host> {
  const hosts = new Map<number, Host>()
  for (const row of rows) {
    if (row.uid !== selfUid) continue
    const entry = entries.find(one => one.pid === row.pid && one.procStart === row.started)
    if (entry === undefined && (rules.system.test(row.command) || !isHostCommand(row.command))) continue
    hosts.set(row.pid, {
      pid: row.pid,
      cwd: entry?.cwd ?? '',
      session: {
        sessionId: entry?.sessionId ?? '',
        pid: row.pid,
        name: entry === undefined ? `claude ${row.pid}` : entry.name || `session ${entry.sessionId.slice(0, 8)}`,
        status: entry?.status || 'running',
        place: entry === undefined ? 'unregistered session' : placeOf(entry.cwd),
        tokensIn: 0,
        tokensOut: 0,
      },
    })
  }
  return hosts
}

function childrenOf(rows: readonly PsRow[]): Map<number, PsRow[]> {
  const kids = new Map<number, PsRow[]>()
  for (const row of rows) {
    if (row.pid === row.ppid || PROBE.test(row.command)) continue
    const list = kids.get(row.ppid)
    if (list === undefined) kids.set(row.ppid, [row])
    else list.push(row)
  }
  return kids
}

/** `pid`'s descendants depth-first, stopping at another session's host. */
function descend(pid: number, kids: Map<number, PsRow[]>, hosts: Map<number, Host>, depth: number): Item[] {
  return (kids.get(pid) ?? []).flatMap(row =>
    hosts.has(row.pid) ? [] : [{ row, depth }, ...descend(row.pid, kids, hosts, depth + 1)],
  )
}

function liveTrees(rows: readonly PsRow[], entries: readonly HostEntry[], selfUid: number, rules: Rules) {
  const hosts = hostsOf(rows, entries, selfUid, rules)
  const kids = childrenOf(rows)
  const owner = new Map<number, number>()
  const order = new Map<number, Item[]>()
  for (const host of hosts.values()) {
    const items = descend(host.pid, kids, hosts, 0)
    for (const item of items) owner.set(item.row.pid, host.pid)
    order.set(host.pid, items)
  }
  return { hosts, kids, owner, order }
}

/** Processes outside every live session's tree: the ones whose env and cwd are worth reading. */
export function candidatesOf(
  rows: readonly PsRow[],
  entries: readonly HostEntry[],
  selfUid: number,
  os: Os,
): number[] {
  const rules = RULES[os]
  const { hosts, owner } = liveTrees(rows, entries, selfUid, rules)
  return rows
    .filter(row => !owner.has(row.pid) && !hosts.has(row.pid) && isCandidate(row, selfUid, rules))
    .map(row => row.pid)
}

/**
 * Sorts every process into a live session or a zombie. Ancestry decides
 * first, then the inherited CLAUDE_PID, then a shell snapshot its session
 * deleted, and the worktree a process sits in last, since a session often
 * works outside its own folder. A process with none of these follows its group.
 */
export function classify(scan: Scan): { groups: SessionGroup[]; zombies: Zombie[] } {
  const { rows, env, cwd } = scan
  const rules = RULES[scan.os]
  const { hosts, kids, owner, order } = liveTrees(rows, scan.entries, scan.selfUid, rules)
  // Who adopts an orphan: launchd on macOS; init or the nearest subreaper on Linux.
  const reapers = new Set([1, ...rows.filter(row => rules.isReaper(row)).map(row => row.pid)])
  const hostIn = (root: string) =>
    [...hosts.values()].find(host => host.cwd === root || host.cwd.startsWith(`${root}/`))

  const claimOf = (row: PsRow): Claim | null => {
    const dir = cwd.get(row.pid) ?? ''
    const inherited = env.get(row.pid)
    if (inherited !== undefined) {
      const host = hosts.get(inherited.claudePid)
      const isSameSession =
        host !== undefined &&
        (host.session.sessionId === '' ||
          inherited.sessionId === null ||
          host.session.sessionId === inherited.sessionId)
      return isSameSession
        ? { kind: 'live', hostPid: inherited.claudePid }
        : { kind: 'zombie', reason: 'session-ended', sessionId: inherited.sessionId, dir }
    }
    const snapshot = snapshotOf(row.command)
    if (snapshot !== null && scan.missingSnapshots.has(snapshot)) {
      return { kind: 'zombie', reason: 'session-ended', sessionId: null, dir }
    }
    // Without the env, only an orphan may be judged by its folder: a person's own shell in a
    // worktree always has a live parent (a terminal, login, tmux, an editor).
    const root = reapers.has(row.ppid) ? worktreeOf(dir) : null
    if (root === null) return null
    const host = hostIn(root)
    if (host !== undefined) return { kind: 'live', hostPid: host.pid }
    const reason = scan.missingWorktrees.has(root) ? 'worktree-deleted' : 'no-live-session'
    return { kind: 'zombie', reason, sessionId: null, dir: root }
  }

  const undead = new Map<number, Extract<Claim, { kind: 'zombie' }>>()
  for (const row of rows) {
    if (owner.has(row.pid) || hosts.has(row.pid) || !isCandidate(row, scan.selfUid, rules)) continue
    const claim = claimOf(row)
    if (claim === null) continue
    if (claim.kind === 'zombie') {
      undead.set(row.pid, claim)
      continue
    }
    // Detached from its session's tree (adopted by a reaper), but the session still runs.
    const items = [{ row, depth: 0 }, ...descend(row.pid, kids, hosts, 1)].filter(
      item => !owner.has(item.row.pid),
    )
    for (const item of items) owner.set(item.row.pid, claim.hostPid)
    order.get(claim.hostPid)?.push(...items)
  }

  // A process group is one Bash tool command, and POSIX keeps a group's id from reuse while any
  // member lives. A member with no evidence of its own (macOS hides the env of its own binaries)
  // goes with a dead sibling, unless something in the group is still owned or not ours.
  const jobs = new Map<number, PsRow[]>()
  for (const row of rows) {
    const job = jobs.get(row.pgid)
    if (job === undefined) jobs.set(row.pgid, [row])
    else job.push(row)
  }
  for (const job of jobs.values()) {
    const claim = job.map(row => undead.get(row.pid)).find(found => found !== undefined)
    const isLeftover = job.every(
      row => !owner.has(row.pid) && !hosts.has(row.pid) && isCandidate(row, scan.selfUid, rules),
    )
    if (claim === undefined || !isLeftover) continue
    for (const row of job) if (!undead.has(row.pid)) undead.set(row.pid, claim)
  }

  // A shell from /bin whose env macOS keeps from us: a `zsh -c` a dead session left running.
  const isBareShell = (row: PsRow) =>
    row.uid === scan.selfUid &&
    rules.hiddenEnv !== null &&
    rules.hiddenEnv.test(row.command) &&
    !env.has(row.pid) &&
    !owner.has(row.pid)
  const byPid = new Map(rows.map(row => [row.pid, row]))
  /** The orphan atop `row`, when every process between them is the same leftover; null otherwise. */
  const orphanOf = (row: PsRow): PsRow | null => {
    let current = row
    for (let hop = 0; hop < 64; hop += 1) {
      if (reapers.has(current.ppid)) return current
      const parent = byPid.get(current.ppid)
      if (parent === undefined || !(undead.has(parent.pid) || isBareShell(parent))) return null
      current = parent
    }
    return null
  }
  const tops = new Map<number, Extract<Claim, { kind: 'zombie' }>>()
  for (const row of rows) {
    const claim = undead.get(row.pid)
    if (claim === undefined || owner.has(row.pid)) continue
    const top = orphanOf(row)
    if (top !== null && !tops.has(top.pid)) tops.set(top.pid, undead.get(top.pid) ?? claim)
  }

  const zombies: Zombie[] = []
  const inTree = new Set<number>()
  for (const row of rows) {
    const claim = tops.get(row.pid)
    if (claim === undefined || inTree.has(row.pid)) continue
    const items = [{ row, depth: 0 }, ...descend(row.pid, kids, hosts, 1)].filter(
      item => !owner.has(item.row.pid) && !inTree.has(item.row.pid),
    )
    for (const item of items) inTree.add(item.row.pid)
    const entry =
      claim.sessionId === null ? undefined : scan.entries.find(one => one.sessionId === claim.sessionId)
    const place = entry !== undefined ? placeOf(entry.cwd) : placeOf(claim.dir) || 'an unknown folder'
    zombies.push({
      root: toProc(row, 0),
      children: items.slice(1).map(item => toProc(item.row, item.depth)),
      reason: claim.reason,
      place,
      session:
        claim.sessionId === null
          ? null
          : {
              sessionId: claim.sessionId,
              pid: null,
              name: entry?.name || `session ${claim.sessionId.slice(0, 8)}`,
              status: 'ended',
              place,
              tokensIn: 0,
              tokensOut: 0,
            },
    })
  }

  const groups = [...hosts.values()].map(host => ({
    session: host.session,
    procs: (order.get(host.pid) ?? []).map(item => toProc(item.row, item.depth)),
  }))
  groups.sort(
    (a, b) =>
      Number(b.session.status === 'busy') - Number(a.session.status === 'busy') ||
      a.session.name.localeCompare(b.session.name),
  )
  zombies.sort((a, b) => a.place.localeCompare(b.place) || a.root.pid - b.root.pid)
  return { groups, zombies }
}

export function totalsOf(groups: readonly SessionGroup[], zombies: readonly Zombie[]): Totals {
  const procs = [
    ...groups.flatMap(group => group.procs),
    ...zombies.flatMap(zombie => [zombie.root, ...zombie.children]),
  ]
  const sessions = new Map<string, Session>()
  for (const session of [
    ...groups.map(group => group.session),
    ...zombies.flatMap(zombie => (zombie.session === null ? [] : [zombie.session])),
  ]) {
    sessions.set(session.sessionId || `pid:${session.pid}`, session)
  }
  return {
    procs: procs.length,
    cpu: sum(procs, proc => proc.cpu),
    rssKb: sum(procs, proc => proc.rssKb),
    tokensIn: sum([...sessions.values()], session => session.tokensIn),
    tokensOut: sum([...sessions.values()], session => session.tokensOut),
  }
}

/**
 * How many zombies the board counts: every process in the zombie trees, a
 * zombie's children included, so the number matches the rows. A defunct one
 * counts too: it is never signalled, but it goes once its parent does.
 */
export const zombieTotal = (zombies: readonly Zombie[]): number =>
  zombies.reduce((total, zombie) => total + 1 + zombie.children.length, 0)

/** How many rows a kill clears: the signalled pids, and the defunct children they leave to a reaper. */
export function laidToRest(zombies: readonly Zombie[], roots: readonly number[], targets: readonly number[]): number {
  return zombies
    .filter(zombie => roots.includes(zombie.root.pid))
    .flatMap(zombie => [zombie.root, ...zombie.children])
    .filter(proc => targets.includes(proc.pid) || (proc.isDefunct && targets.includes(proc.ppid))).length
}

/**
 * The living members of the chosen zombies' trees, deepest first, so no
 * parent dies before its children and hands them to a reaper mid-kill.
 * A defunct process is already dead: it goes once its parent does.
 */
export function killOrder(zombies: readonly Zombie[], roots: readonly number[]): Proc[] {
  return zombies
    .filter(zombie => roots.includes(zombie.root.pid))
    .flatMap(zombie => [zombie.root, ...zombie.children])
    .filter(proc => !proc.isDefunct)
    .sort((a, b) => b.depth - a.depth)
}

/** The planned pids that still name the very process the board showed, and that are ours to signal. */
export function stillSame(planned: readonly Proc[], rows: readonly PsRow[], guard: Guard): number[] {
  const now = new Map(rows.map(row => [row.pid, row]))
  return planned
    .filter(proc => {
      const row = now.get(proc.pid)
      return (
        row !== undefined &&
        row.pid > 1 &&
        row.uid === guard.selfUid &&
        !guard.protectedPids.has(row.pid) &&
        !isHostCommand(row.command) &&
        !row.stat.includes('Z') &&
        row.started === proc.started &&
        row.command.slice(0, COMMAND_MAX) === proc.command
      )
    })
    .map(proc => proc.pid)
}

export function bytes(count: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = count
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 || value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

export const memory = (kb: number): string => bytes(kb * 1024)

export function count(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`
  return String(value)
}
