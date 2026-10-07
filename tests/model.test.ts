import { describe, expect, test } from 'claude-code/testing'

import { classify, killOrder, laidToRest, parseEnv, parsePs, stillSame, tallyUsage, zombieTotal } from '../hooks/model'
import type { HostEntry, ProcEnv, PsRow, Scan } from '../hooks/model'

const UID = 501
const STARTED = 'Tue Oct 6 14:13:53 2026'
const HOST =
  '/Users/me/Library/Application Support/Claude/claude-code/2.1.288/abc/claude.app/Contents/MacOS/claude --output-format stream-json'
const REPO = '/Users/me/repo'
const ALIVE_TREE = `${REPO}/.claude/worktrees/alive-1a2b3c`
const LIVE_ID = '11111111-1111-1111-1111-111111111111'
const SNAPSHOTS = '/Users/me/.claude/shell-snapshots'

const row = (pid: number, ppid: number, command: string, extra: Partial<PsRow> = {}): PsRow => ({
  pid,
  ppid,
  pgid: pid,
  uid: UID,
  stat: 'S',
  cpu: 1,
  rssKb: 2048,
  started: STARTED,
  command,
  ...extra,
})
const entry = (pid: number, sessionId: string, cwd: string): HostEntry => ({
  pid,
  sessionId,
  cwd,
  name: `session at ${pid}`,
  status: 'idle',
  procStart: STARTED,
})
const scanOf = (rows: PsRow[], more: Partial<Scan> = {}): Scan => ({
  rows,
  entries: [entry(100, LIVE_ID, ALIVE_TREE)],
  env: new Map(),
  cwd: new Map(),
  missingWorktrees: new Set(),
  missingSnapshots: new Set(),
  selfUid: UID,
  os: 'darwin',
  ...more,
})
const inherited = (pairs: Array<[number, ProcEnv]>) => new Map(pairs)
/** The command line of a Bash tool shell, which a subshell it forks keeps. */
const bashTool = (snapshot: string, script: string) =>
  `/bin/zsh -c source ${SNAPSHOTS}/${snapshot} 2>/dev/null || true && eval '${script}' < /dev/null && pwd -P >| /tmp/claude-1a2b-cwd`

describe('classify', () => {
  test('a process whose session host died is a zombie, its children in its tree', async () => {
    const rows = [
      row(100, 1, HOST),
      row(300, 1, 'node /x/next dev'),
      row(301, 300, 'node /x/worker.js'),
      row(302, 301, '<defunct>', { stat: 'Z' }),
    ]
    const env = inherited([[300, { claudePid: 999, sessionId: 'dead-session' }]])
    const { groups, zombies } = classify(scanOf(rows, { env }))
    expect(zombies.map(zombie => zombie.root.pid)).toEqual([300])
    expect(zombies[0]?.reason).toBe('session-ended')
    expect(zombies[0]?.children.map(child => child.pid)).toEqual([301, 302])
    expect(groups[0]?.procs).toEqual([])
  })

  test('a live session keeps its descendants and its detached children', async () => {
    const rows = [
      row(100, 1, HOST),
      row(200, 100, '/bin/zsh -c pnpm dev'),
      row(201, 200, 'node /x/turbo'),
      row(210, 1, 'node /x/server.js'),
    ]
    const env = inherited([[210, { claudePid: 100, sessionId: LIVE_ID }]])
    const { groups, zombies } = classify(scanOf(rows, { env }))
    expect(zombies).toEqual([])
    expect(groups[0]?.procs.map(proc => proc.pid)).toEqual([200, 201, 210])
  })

  test('a reused host pid does not keep a dead session alive', async () => {
    const rows = [
      row(100, 1, 'node /x/unrelated.js', { started: 'Wed Oct 7 09:00:00 2026' }),
      row(300, 1, 'node /x/next dev'),
    ]
    const env = inherited([[300, { claudePid: 100, sessionId: LIVE_ID }]])
    const { groups, zombies } = classify(scanOf(rows, { env }))
    expect(groups).toEqual([])
    expect(zombies.map(zombie => zombie.root.pid)).toEqual([300])
  })

  test('a host pid now running another session does not adopt the old orphans', async () => {
    const rows = [row(100, 1, HOST), row(300, 1, 'node /x/next dev')]
    const env = inherited([[300, { claudePid: 100, sessionId: 'older-session' }]])
    const { zombies } = classify(scanOf(rows, { env }))
    expect(zombies.map(zombie => zombie.root.pid)).toEqual([300])
  })

  test('an unregistered Claude Code process still protects its children', async () => {
    const rows = [row(150, 1, 'node /Users/me/.nvm/versions/node/v22/bin/claude'), row(310, 1, 'node /x/vite')]
    const env = inherited([[310, { claudePid: 150, sessionId: 'unknown-session' }]])
    const { zombies } = classify(scanOf(rows, { entries: [], env }))
    expect(zombies).toEqual([])
  })

  test('without an inherited env, the worktree a process sits in decides', async () => {
    const rows = [
      row(100, 1, HOST),
      row(400, 1, '/bin/zsh'),
      row(401, 1, '/bin/zsh'),
      row(402, 1, '/bin/zsh'),
      row(403, 1, '/bin/zsh'),
    ]
    const cwd = new Map([
      [400, `${ALIVE_TREE}/apps/web`],
      [401, `${REPO}/.claude/worktrees/idle-4d5e6f`],
      [402, `${REPO}/.claude/worktrees/gone-7a8b9c`],
      [403, REPO],
    ])
    const missingWorktrees = new Set([`${REPO}/.claude/worktrees/gone-7a8b9c`])
    const { groups, zombies } = classify(scanOf(rows, { cwd, missingWorktrees }))
    expect(groups[0]?.procs.map(proc => proc.pid)).toEqual([400])
    expect(zombies.map(zombie => [zombie.root.pid, zombie.reason])).toEqual([
      [402, 'worktree-deleted'],
      [401, 'no-live-session'],
    ])
  })

  test('a person’s own shell in an abandoned worktree is left alone', async () => {
    const rows = [
      row(100, 1, HOST),
      row(700, 1, '/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal'),
      row(701, 700, '/usr/bin/login -pf me', { uid: 0 }),
      row(702, 701, '/bin/zsh -il'),
      row(703, 702, 'node /x/vite'),
    ]
    const idle = `${REPO}/.claude/worktrees/idle-4d5e6f`
    const cwd = new Map([
      [702, idle],
      [703, idle],
    ])
    expect(classify(scanOf(rows, { cwd })).zombies).toEqual([])
  })

  test('the shell a dead session left running is a zombie along with what it runs', async () => {
    const rows = [
      row(100, 1, HOST),
      row(800, 1, '/bin/zsh -c pnpm dev'),
      row(801, 800, 'node /x/pnpm dev'),
      row(802, 801, 'node /x/next-server'),
    ]
    const env = inherited([[801, { claudePid: 999, sessionId: 'dead-session' }]])
    const { zombies } = classify(scanOf(rows, { env, cwd: new Map([[800, REPO]]) }))
    expect(zombies.map(zombie => [zombie.root.pid, zombie.reason])).toEqual([[800, 'session-ended']])
    expect(zombies[0]?.children.map(child => child.pid)).toEqual([801, 802])
  })

  test('a dead session’s env inside an app’s terminal is not a zombie', async () => {
    const rows = [
      row(100, 1, HOST),
      row(900, 1, '/Applications/Cursor.app/Contents/Frameworks/Cursor Helper'),
      row(901, 900, '/bin/zsh -il'),
      row(902, 901, 'node /x/vite'),
    ]
    const env = inherited([[902, { claudePid: 999, sessionId: 'dead-session' }]])
    expect(classify(scanOf(rows, { env })).zombies).toEqual([])
  })

  test('a Bash tool shell whose session deleted its snapshot is a zombie, one whose snapshot remains is not', async () => {
    const gone = 'snapshot-zsh-1791297127762-ukxiro.sh'
    const kept = 'snapshot-zsh-1791305381553-xhi34d.sh'
    const rows = [
      row(100, 1, HOST),
      row(600, 1, bashTool(gone, 'while :; do :; done')),
      row(610, 1, bashTool(kept, 'while :; do sleep 5; done')),
      row(611, 610, '/bin/sleep 5', { pgid: 610 }),
    ]
    const missingSnapshots = new Set([`${SNAPSHOTS}/${gone}`])
    const { zombies } = classify(scanOf(rows, { missingSnapshots }))
    expect(zombies.map(zombie => [zombie.root.pid, zombie.reason])).toEqual([[600, 'session-ended']])
  })

  test('a process with no evidence of its own goes with its process group, unless the group holds an app', async () => {
    const rows = [
      row(100, 1, HOST),
      row(620, 1, 'node /x/server.js', { pgid: 619 }),
      row(621, 1, '/usr/bin/tail -f /tmp/server.log', { pgid: 619 }),
      row(640, 1, 'node /x/dev.js', { pgid: 639 }),
      row(641, 1, '/usr/bin/tail -f /tmp/dev.log', { pgid: 639 }),
      row(642, 1, '/Applications/Visual Studio Code.app/Contents/MacOS/Electron .', { pgid: 639 }),
    ]
    const env = inherited([
      [620, { claudePid: 999, sessionId: 'dead-session' }],
      [640, { claudePid: 999, sessionId: 'dead-session' }],
    ])
    expect(classify(scanOf(rows, { env })).zombies.map(zombie => zombie.root.pid)).toEqual([620, 621, 640])
  })

  test('on Linux an orphan the user’s systemd adopted is judged like one launchd adopted', async () => {
    const rows = [
      row(100, 1, HOST),
      row(900, 1, '/usr/lib/systemd/systemd --user'),
      row(910, 900, 'node /x/next dev'),
      row(920, 900, '/usr/libexec/gnome-terminal-server'),
      row(921, 920, 'bash'),
      row(922, 921, 'node /x/vite'),
      row(930, 900, '/usr/share/code/code --unity-launch'),
    ]
    const dead = { claudePid: 999, sessionId: 'dead-session' }
    const env = inherited([
      [910, dead],
      [922, dead],
      [930, dead],
    ])
    expect(classify(scanOf(rows, { env, os: 'linux' })).zombies.map(zombie => zombie.root.pid)).toEqual([910])
    // macOS has no subreapers, so there the same process is still someone's child.
    expect(classify(scanOf(rows, { env, os: 'darwin' })).zombies).toEqual([])
  })

  test('a registered session counts wherever its binary is installed', async () => {
    const rows = [row(100, 1, '/opt/claude-code/claude'), row(300, 1, 'node /x/next dev')]
    const env = inherited([[300, { claudePid: 100, sessionId: LIVE_ID }]])
    const { groups, zombies } = classify(scanOf(rows, { env, os: 'linux' }))
    expect(zombies).toEqual([])
    expect(groups[0]?.procs.map(proc => proc.pid)).toEqual([300])
  })

  test('the mod’s own probes stay out of its session’s card on either system', async () => {
    // Each probe sits right under the host, as it does once a shell execs its last command.
    const rows = [
      row(100, 1, HOST),
      row(110, 100, 'ps axww -o pid=,ppid=,pgid=,uid=,stat=,%cpu=,rss=,lstart=,command='),
      row(111, 100, `/bin/sh -c for p; do printf '%s ' "$p"; tr '\\0\\n' '  ' < "/proc/$p/environ" 2>/dev/null; echo; done sh 300`),
      row(112, 100, 'tr \\0\\n   '),
      row(113, 100, `/bin/sh -c for p; do d=$(readlink "/proc/$p/cwd" 2>/dev/null) && printf 'p%s\\nn%s\\n' "$p" "$d"; done sh 300`),
      row(114, 100, 'readlink /proc/300/cwd'),
      row(115, 100, '/bin/sh -c { dd bs=1 skip="$1" count=0 2>/dev/null; head -c 4194304; } < "$2" sh 0 /t.jsonl'),
      row(116, 100, 'dd bs=1 skip=0 count=0'),
      row(117, 100, 'head -c 4194304'),
      row(120, 100, 'node /x/next dev'),
    ]
    for (const os of ['darwin', 'linux'] as const) {
      expect(classify(scanOf(rows, { os })).groups[0]?.procs.map(proc => proc.pid)).toEqual([120])
    }
  })

  test('other users and system processes are never claimed', async () => {
    const rows = [
      row(100, 1, HOST),
      row(500, 1, 'node /x/next dev', { uid: 0 }),
      row(501, 1, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    ]
    const env = inherited([
      [500, { claudePid: 999, sessionId: 'dead-session' }],
      [501, { claudePid: 999, sessionId: 'dead-session' }],
    ])
    expect(classify(scanOf(rows, { env })).zombies).toEqual([])
  })
})

describe('killing', () => {
  const rows = [
    row(100, 1, HOST),
    row(300, 1, 'node /x/next dev'),
    row(301, 300, 'node /x/worker.js'),
    row(302, 301, '<defunct>', { stat: 'Z' }),
  ]
  const env = inherited([[300, { claudePid: 999, sessionId: 'dead-session' }]])
  const guard = { selfUid: UID, protectedPids: new Set([100]) }

  test('goes deepest first and skips the defunct', async () => {
    const { zombies } = classify(scanOf(rows, { env }))
    expect(killOrder(zombies, [300]).map(proc => proc.pid)).toEqual([301, 300])
    expect(killOrder(zombies, [999])).toEqual([])
  })

  test('counts every row, the defunct included, which a kill clears along with its parent', async () => {
    const { zombies } = classify(scanOf(rows, { env }))
    expect(zombieTotal(zombies)).toBe(3)
    expect(laidToRest(zombies, [300], [301, 300])).toBe(3)
    // 301 was spared (it changed since the scan), so its defunct child stays.
    expect(laidToRest(zombies, [300], [300])).toBe(1)
  })

  test('only signals a pid that still names the same process', async () => {
    const { zombies } = classify(scanOf(rows, { env }))
    const planned = killOrder(zombies, [300])
    expect(stillSame(planned, rows, guard)).toEqual([301, 300])
    const restarted = rows.map(one => (one.pid === 301 ? { ...one, started: 'Wed Oct 7 09:00:00 2026' } : one))
    expect(stillSame(planned, restarted, guard)).toEqual([300])
    const replaced = rows.map(one => (one.pid === 300 ? { ...one, command: 'vim notes.md' } : one))
    expect(stillSame(planned, replaced, guard)).toEqual([301])
    expect(stillSame(planned, [], guard)).toEqual([])
  })

  test('never signals a session host, another user, or a protected pid', async () => {
    const [zombie] = classify(scanOf(rows, { env })).zombies
    if (zombie === undefined) throw new Error('expected a zombie')
    const asHost = rows.map(one => (one.pid === 300 ? { ...one, command: HOST } : one))
    expect(stillSame([{ ...zombie.root, command: HOST }], asHost, guard)).toEqual([])
    const asRoot = rows.map(one => (one.pid === 300 ? { ...one, uid: 0 } : one))
    expect(stillSame([zombie.root], asRoot, guard)).toEqual([])
    expect(stillSame([zombie.root], rows, { selfUid: UID, protectedPids: new Set([300]) })).toEqual([])
  })
})

describe('parsing', () => {
  test('reads ps rows with lstart and commands holding spaces', async () => {
    const [parsed] = parsePs(
      '  4745  4744  4744   501 Ss     0.5 123456 Tue Oct  6 14:13:53 2026 /Users/me/Library/Application Support/claude --verbose\n',
    )
    expect(parsed).toEqual({
      pid: 4745,
      ppid: 4744,
      pgid: 4744,
      uid: 501,
      stat: 'Ss',
      cpu: 0.5,
      rssKb: 123456,
      started: 'Tue Oct 6 14:13:53 2026',
      command: '/Users/me/Library/Application Support/claude --verbose',
    })
  })

  test('reads the inherited session from ps eww', async () => {
    const env = parseEnv(
      '16505 node jest.js PATH=/bin CLAUDE_PID=4745 CLAUDE_CODE_SESSION_ID=0e27d97f-ad7a-464e-ac13-81fa72123602 X=1\n16506 node plain.js PATH=/bin\n',
    )
    expect(env.get(16505)).toEqual({ claudePid: 4745, sessionId: '0e27d97f-ad7a-464e-ac13-81fa72123602' })
    expect(env.has(16506)).toBe(false)
  })

  test('counts each API response once', async () => {
    const line = (id: string, input: number, output: number) =>
      JSON.stringify({
        type: 'assistant',
        message: {
          id,
          usage: { input_tokens: input, cache_creation_input_tokens: 10, cache_read_input_tokens: 100, output_tokens: output },
        },
      })
    const tally = { seen: new Set<string>(), tokensIn: 0, tokensOut: 0 }
    tallyUsage([line('msg_a', 1, 5), line('msg_a', 1, 5), line('msg_b', 2, 7), '{"type":"user"}', 'not json'].join('\n'), tally)
    expect([tally.tokensIn, tally.tokensOut]).toEqual([111 + 112, 12])
  })
})
