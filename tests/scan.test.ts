import { expect, test } from 'claude-code/testing'
import type { ProcessRunResult } from 'claude-code'

import { contextOf, scan } from '../hooks/scan'
import type { Context, Envs, Io, Readings } from '../hooks/scan'

const HOME = '/Users/me'
const STARTED = 'Tue Oct  6 14:13:53 2026'
const HOST = `${HOME}/Library/Application Support/Claude/claude-code/2.1.288/abc/claude.app/Contents/MacOS/claude`
const SESSION = '11111111-2222-3333-4444-555555555555'
const TRANSCRIPT = `${HOME}/.claude/projects/-Users-me-repo/${SESSION}.jsonl`
const CONTEXT: Context = {
  home: HOME,
  os: 'darwin',
  selfUid: 501,
  selfHostPid: 100,
  machine: { cores: 10, memoryKb: 1024 },
}

const psLine = (pid: number, command: string) => `${pid} 1 ${pid} 501 S 0.0 1000 ${STARTED} ${command}`
const result = (stdout: string): ProcessRunResult => ({
  exitCode: 0,
  stdout,
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false,
})
const bytesOf = (text: string) => new TextEncoder().encode(text)
const usage = (id: string, input: number, output: number, text = '') =>
  JSON.stringify({ type: 'assistant', message: { id, content: text, usage: { input_tokens: input, output_tokens: output } } })

/**
 * A machine running one live session (100), whose process table, environments,
 * working folders and transcript a test edits. It answers the macOS probes
 * (ps eww, lsof) and the Linux ones (/proc through sh) from the same state.
 */
function machine() {
  const state = {
    ps: [psLine(100, HOST)],
    envs: new Map<number, string>(),
    cwds: new Map<number, string>(),
    transcript: '',
  }
  const ran: string[][] = []
  const envsOf = (pids: number[]) => result(pids.flatMap(pid => state.envs.get(pid) ?? []).join('\n'))
  const cwdsOf = (pids: number[]) =>
    result(pids.flatMap(pid => (state.cwds.has(pid) ? [`p${pid}\nn${state.cwds.get(pid)}`] : [])).join('\n'))
  const listed = (argv: readonly string[]) => (argv.at(-1) ?? '').split(',').map(Number)
  const io: Io = {
    run: async argv => {
      ran.push([...argv])
      const [command, first, script = ''] = argv
      if (command === 'ps' && (first === '-axww' || first === 'axww')) return result(state.ps.join('\n'))
      if (command === 'ps' && first === 'eww') return envsOf(listed(argv))
      if (command === 'lsof') return cwdsOf(listed(argv))
      if (command === 'find') return result(`${TRANSCRIPT}\n`)
      if (command === '/bin/sh' && script.includes('/proc/$p/environ')) return envsOf(argv.slice(4).map(Number))
      if (command === '/bin/sh' && script.includes('/proc/$p/cwd')) return cwdsOf(argv.slice(4).map(Number))
      // The transcript reader: everything from the byte it asks for.
      if (command === '/bin/sh' && script.startsWith('{ dd')) {
        return result(new TextDecoder().decode(bytesOf(state.transcript).subarray(Number(argv[4]))))
      }
      return result('')
    },
    exists: async path => path === `${HOME}/.claude/sessions`,
    list: async () => [{ name: '100.json', kind: 'file', size: 1, mtimeMs: 0, isLink: false }],
    read: async () =>
      JSON.stringify({ pid: 100, sessionId: SESSION, cwd: `${HOME}/repo`, name: 'Live one', status: 'idle', procStart: STARTED }),
    stat: async () => ({ kind: 'file', size: bytesOf(state.transcript).length, mtimeMs: 0, isLink: false }),
    home: async () => HOME,
    now: async () => 0,
  }
  return { state, ran, io }
}

test('reads a transcript in whole lines, from the byte the last scan stopped at', async () => {
  const { state, ran, io } = machine()
  const readings: Readings = new Map()
  const envs: Envs = new Map()
  const tokens = async () => {
    const session = (await scan(io, CONTEXT, readings, envs)).groups[0]?.session
    return [session?.tokensIn, session?.tokensOut]
  }
  // A multi-byte character, so a count in characters would land on the wrong byte.
  const done = `${usage('msg_a', 1, 10, '🧟 a zombie rose')}\n${usage('msg_b', 2, 20)}\n`
  const third = usage('msg_c', 4, 40)

  state.transcript = `${done}${third.slice(0, 20)}`
  expect(await tokens()).toEqual([3, 30])
  // The half-written line is read again, whole, once it ends.
  state.transcript = `${done}${third}\n`
  expect(await tokens()).toEqual([7, 70])

  const skips = ran.filter(argv => argv[2]?.startsWith('{ dd')).map(argv => Number(argv[4]))
  const end = bytesOf(done).length
  expect(skips).toEqual([0, end, end])
})

test('asks for a process’s environment once, and again for one ps did not print', async () => {
  const { state, ran, io } = machine()
  const readings: Readings = new Map()
  const envs: Envs = new Map()
  const zombies = async () => (await scan(io, CONTEXT, readings, envs)).zombies.map(zombie => zombie.root.pid)
  state.ps.push(psLine(300, 'node /x/next dev'))
  state.envs.set(300, '  300 node next dev CLAUDE_PID=999 CLAUDE_CODE_SESSION_ID=dead-session')

  expect(await zombies()).toEqual([300])
  expect(await zombies()).toEqual([300])
  state.ps.push(psLine(310, 'node /x/vite'))
  expect(await zombies()).toEqual([300])
  state.envs.set(310, '  310 node vite CLAUDE_PID=999 CLAUDE_CODE_SESSION_ID=dead-session')
  expect(await zombies()).toEqual([300, 310])

  const asked = ran.filter(argv => argv[0] === 'ps' && argv[1] === 'eww').map(argv => argv.at(-1))
  expect(asked).toEqual(['300', '310', '310'])
})

test('on Linux, reads processes through procps and environments and folders through /proc', async () => {
  const { state, ran, io } = machine()
  state.ps.push(psLine(300, 'node /x/next dev'))
  state.envs.set(300, '300 PATH=/usr/bin CLAUDE_PID=999 CLAUDE_CODE_SESSION_ID=dead-session')
  state.cwds.set(300, `${HOME}/repo/.claude/worktrees/gone-1a2b3c`)

  const snap = await scan(io, { ...CONTEXT, os: 'linux' }, new Map(), new Map())
  expect(snap.zombies.map(zombie => [zombie.root.pid, zombie.place])).toEqual([[300, 'repo › gone-1a2b3c']])
  const probes = ran.map(argv => argv.slice(0, 2).join(' '))
  expect(probes).toContain('ps axww')
  expect(probes.filter(probe => probe === 'ps eww' || probe.startsWith('lsof'))).toEqual([])
})

test('tells macOS from Linux, reads Linux cores and memory, and refuses any other system', async () => {
  const { io } = machine()
  const answering = (system: string): Io => ({
    ...io,
    run: async argv =>
      result(
        argv[2]?.startsWith('echo') ? `4321 1000 ${system}\n` : argv[2]?.startsWith('getconf') ? '8\nMemTotal:       16303468 kB\n' : '',
      ),
  })
  expect(await contextOf(answering('Linux'))).toEqual({
    home: HOME,
    os: 'linux',
    selfHostPid: 4321,
    selfUid: 1000,
    machine: { cores: 8, memoryKb: 16303468 },
  })
  expect((await contextOf(answering('Darwin'))).os).toBe('darwin')
  const refused = await contextOf(answering('MINGW64_NT-10.0')).then(
    () => null,
    (error: unknown) => error,
  )
  expect(refused).toBeInstanceOf(Error)
})
