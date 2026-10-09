import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, PaneOpenArgs, ProcessRunResult, UiOpenResult } from 'claude-code'

const HOME = '/Users/me'
const HOST = `${HOME}/Library/Application Support/Claude/claude-code/2.1.288/abc/claude.app/Contents/MacOS/claude --output-format stream-json`
const GONE = `${HOME}/repo/.claude/worktrees/gone-1a2b3c`
const PS = [
  `  100     1    99   501 S      0.3  90000 Tue Oct  6 14:13:53 2026 ${HOST}`,
  `  200   100   200   501 S      0.0   4000 Tue Oct  6 14:20:00 2026 /bin/zsh -c pnpm test`,
  `  300     1   290   501 S      2.5 300000 Tue Oct  6 15:00:00 2026 node ${GONE}/node_modules/.bin/next dev`,
  `  301   300   290   501 S      0.1  50000 Tue Oct  6 15:00:01 2026 node ${GONE}/node_modules/next/worker.js`,
].join('\n')
const REGISTRY = JSON.stringify({
  pid: 100,
  sessionId: '11111111-2222-3333-4444-555555555555',
  cwd: `${HOME}/repo`,
  name: 'Live one',
  status: 'busy',
  procStart: 'Tue Oct  6 14:13:53 2026',
})
const ENV = '  300 node next dev PATH=/bin CLAUDE_PID=999 CLAUDE_CODE_SESSION_ID=99999999-8888-7777-6666-555555555555'
const CWD = `p300\nfcwd\nn${GONE}\np301\nfcwd\nn${GONE}\n`
const PANE = {
  plugin: 'rest-in-pid',
  component: 'Pane',
  requestId: 'rest-in-pid',
  props: {
    title: 'Rest in PID',
    isFocused: false,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 80 },
    view: {},
  },
} as const
const BAND = {
  plugin: 'rest-in-pid',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {} },
} as const
const OUTPUT = {
  plugin: 'rest-in-pid',
  component: 'CommandOutput',
  props: { command: 'rest-in-pid', args: '', text: 'Rest in PID', isErrored: false },
} as const
const RUN = {
  command: 'rest-in-pid',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
} as const

const ok = (stdout: string): { value: ProcessRunResult } => ({
  value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

/**
 * Stands in for the host: a live session (100) and a dead session's orphan (300) with its child
 * (301). A test moves the process table on through `world.ps`.
 */
function host(on: On, seat: UiOpenResult = { isPlaced: true }) {
  const ran: string[][] = []
  const opened: PaneOpenArgs[] = []
  const world = { ps: PS }
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    const [command, first] = e.argv
    if (command === '/bin/sh' && e.argv[2]?.startsWith('echo')) return ok('100 501 Darwin\n')
    if (command === 'ps' && first === '-axww') return ok(world.ps)
    if (command === 'ps' && first === 'eww') return ok(ENV)
    if (command === 'lsof') return ok(CWD)
    return ok('')
  })
  on('fs.exists', (_, e) => ({ value: e.path === `${HOME}/.claude/sessions` }))
  on('fs.list', () => ({ value: [{ name: '100.json', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }))
  on('fs.read', () => ({ value: REGISTRY }))
  on('settings.read', () => ({ value: {} }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', (_, e) => {
    opened.push(e)
    return { value: seat }
  })
  on('ui.panes', () => ({ value: [] }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  mock.env(on, { HOME })
  const clock = mock.clock(on)
  return { ran, opened, world, clock }
}

/** The board on the terminal, the zombies section open. */
async function board($: Engine) {
  await $.session.start({ cwd: `${HOME}/repo`, surface: 'terminal', isInteractive: true })
  await $.command.run(RUN)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'toggle-zombies' })
  return ui
}

test('sections start closed, open on their chevron, and a dead session’s orphan is killed on press', async ($, on) => {
  const { ran } = host(on)
  await $.session.start({ cwd: `${HOME}/repo`, surface: 'desktop', isInteractive: true })
  await $.command.run(RUN)

  for (const surface of ['terminal', 'desktop'] as const) {
    const closed = await $.ui.mount({ ...PANE, surface })
    expect(await closed.find({ key: 'zombie-300' })).toBeUndefined()
    expect(await closed.find({ key: 'session-100' })).toBeUndefined()
    await closed.unmount()
  }

  // On the desktop the drawn heading takes the press through its see-through region.
  const opener = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await opener.pointer({ type: 'down', x: 2, y: 0, button: 'left', in: 'press-zombies' })
  await opener.pointer({ type: 'down', x: 2, y: 0, button: 'left', in: 'press-sessions' })
  await opener.unmount()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'zombie-300' })).toBeDefined()
    expect(await ui.find({ key: 'session-100' })).toBeDefined()
    expect(await ui.find({ key: 'kill-300' })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'kill-all' })
  expect(ran.some(argv => argv[0] === '/bin/kill')).toBe(false)
  await ui.press({ key: 'kill-300' })
  expect(ran).toContainEqual(['/bin/kill', '-TERM', '301', '300'])
  expect(ran.some(argv => argv[0] === '/bin/kill' && argv.includes('100'))).toBe(false)
  await ui.unmount()
})

test('Kill takes the tree as it runs when pressed, and its SIGKILL pass what rose in the group meanwhile', async ($, on) => {
  const { ran, world, clock } = host(on)
  const ui = await board($)
  // A worker 301 spawned after the board was drawn.
  world.ps = `${PS}\n  302   301   290   501 S      0.0   1000 Tue Oct  6 15:00:02 2026 node ${GONE}/worker.js --child`
  await ui.press({ key: 'kill-300' })
  expect(ran).toContainEqual(['/bin/kill', '-TERM', '302', '301', '300'])
  // 301 shrugged SIGTERM off, and 303 rose in its group while 300 went down.
  world.ps = [
    `  100     1    99   501 S      0.3  90000 Tue Oct  6 14:13:53 2026 ${HOST}`,
    `  301     1   290   501 S      0.1  50000 Tue Oct  6 15:00:01 2026 node ${GONE}/node_modules/next/worker.js`,
    `  303     1   290   501 S      0.0   1000 Tue Oct  6 15:00:03 2026 node ${GONE}/cleanup.js`,
  ].join('\n')
  await clock.advance(2_000)
  expect(ran).toContainEqual(['/bin/kill', '-KILL', '301', '303'])
  await ui.unmount()
})

test('Kill spares a zombie that a live session has started inside since the board was drawn', async ($, on) => {
  const { ran, world } = host(on)
  const ui = await board($)
  world.ps = `${PS}\n  302   301   302   501 S      0.0   1000 Tue Oct  6 15:10:00 2026 ${HOST}`
  await ui.press({ key: 'kill-300' })
  expect(ran.some(argv => argv[0] === '/bin/kill')).toBe(false)
  await ui.unmount()
})

test('the band clears within seconds once its zombies die elsewhere, before the slow scan comes round', async ($, on) => {
  const { world, clock } = host(on)
  // What the engine draws when no plugin fills the band.
  on('ui.render', { component: 'AbovePrompt' }, (kit, e) => {
    const { Box } = kit.ui.resolve(e)
    return <Box key="engine-band" />
  })
  await $.session.start({ cwd: `${HOME}/repo`, surface: 'desktop', isInteractive: true })
  await clock.advance(1_000)
  const before = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await before.find({ key: 'open-graveyard' })).toBeDefined()
  await before.unmount()
  // Another session laid 300 and 301 to rest.
  world.ps = PS.split('\n').slice(0, 2).join('\n')
  await clock.advance(2_000)
  const after = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await after.find({ key: 'open-graveyard' })).toBeUndefined()
  await after.unmount()
})

test('the band above the prompt counts every zombie process and opens the graveyard', async ($, on) => {
  const { opened } = host(on)
  await $.session.start({ cwd: `${HOME}/repo`, surface: 'desktop', isInteractive: true })
  await $.command.run(RUN)
  const before = opened.length

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.press({ key: 'open-graveyard' })
    await ui.unmount()
  }

  // A zombie and its child are two zombies: the count matches the rows a card lists.
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await band.find({ type: 'Svg' }))?.props.alt).toBe('2 zombies left behind by ended sessions')
  await band.unmount()
  expect(opened.length - before).toBe(2)
  expect(opened.at(-1)?.id).toBe('rest-in-pid')
})

test('where no pane can be seated, the command’s own row draws the board', async ($, on) => {
  host(on, { isPlaced: false, reason: 'this surface places no panes' })
  await $.session.start({ cwd: `${HOME}/repo`, surface: 'desktop', isInteractive: true })
  await $.command.run(RUN)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...OUTPUT, surface })
    expect(await ui.find({ key: 'kill-all' })).toBeDefined()
    await ui.unmount()
  }
  // On the terminal the heading is a Button.
  const ui = await $.ui.mount({ ...OUTPUT, surface: 'terminal' })
  await ui.press({ key: 'toggle-zombies' })
  expect(await ui.find({ key: 'kill-300' })).toBeDefined()
  await ui.unmount()
})
