import { atom, read, update } from 'claude-code'
import type { Elements, Register, RenderElement, RenderSurface } from 'claude-code'

import type { Proc, SessionGroup, Snapshot, Zombie } from '../types'
import { count, killOrder, laidToRest, memory, stillSame, zombieTotal } from './model'
import { clip, header, icons, NIGHT, note, notice, pill, screen, strip, table as processTable } from './panels'
import type { Drawing, Line } from './panels'
import { contextOf, readPs, scan } from './scan'
import type { Context, Envs, Io, Readings } from './scan'
import { raster, title } from './sprites'
import type { Sprite } from './sprites'

const PANE = 'rest-in-pid'
const TICK_MS = 5_000
/** While the pane is closed only every SLOW_TICKS-th tick scans: enough to keep the status line honest. */
const SLOW_TICKS = 6
/** While the band counts zombies, how often one `ps` checks that they still run. */
const WATCH_MS = 2_000
const ARMED_MS = 4_000
/** How long SIGTERM gets before SIGKILL follows. */
const GRACE_MS = 2_000
const ROWS_SHOWN = 8
/** A card's right-hand column, for its button or badge: one width, so every card's text lines up. */
const ACTION_CELLS = 12
/** Card border and padding, in cells. */
const CARD_CHROME = 4
/** Roughly how many CSS pixels a desktop draws per cell; only sizes drawings, which shrink to fit. */
const CELL_PX = 8
const TERMINAL_SEGMENTS = 16

const snapshot = atom({ plugin: 'rest-in-pid', key: 'snapshot' } as const, null)
const isArmed = atom({ plugin: 'rest-in-pid', key: 'isArmed' } as const, false)
const killing = atom({ plugin: 'rest-in-pid', key: 'killing' } as const, [])
/** False once the surface would not seat the pane: the command's own row then draws the board. */
const isPlaced = atom({ plugin: 'rest-in-pid', key: 'isPlaced' } as const, true)
/** Which sections are open. Both start closed; a press on a section's heading opens it. */
const zombiesOpen = atom({ plugin: 'rest-in-pid', key: 'zombiesOpen' } as const, false)
const sessionsOpen = atom({ plugin: 'rest-in-pid', key: 'sessionsOpen' } as const, false)
/** The zombie count alone, for the band: it redraws when the count moves, not on every scan. */
const zombieCount = atom({ plugin: 'rest-in-pid', key: 'zombieCount' } as const, 0)

/** Pastel windows: a rose one for each zombie, a lavender one for each session. */
const CARD = {
  zombie: { borderColor: '#f2a7bf', backgroundColor: '#fff3f6' },
  session: { borderColor: '#cdc0f2', backgroundColor: '#f8f5ff' },
}

type Common = Pick<Elements['desktop'], 'Box' | 'Text' | 'Button'>
type Table = Elements[keyof Elements]
/** How a surface draws the board's parts: drawings where it has Svg, padded text where it is a terminal. */
type Kit = {
  screen: (snap: Snapshot) => RenderElement
  /** A section's heading, which opens and closes it. */
  toggle: (section: Section, label: string, isOpen: boolean) => RenderElement
  /** The heading that stands in for the zombies when there are none: nothing to open. */
  quiet: (label: string) => RenderElement
  note: (message: string, tone: 'soft' | 'alarm') => RenderElement
  header: (icon: Sprite, title: string, subtitle: string) => RenderElement
  table: (lines: readonly Line[], more: number) => RenderElement
  pill: (status: string) => RenderElement
}
type Section = 'zombies' | 'sessions'
type View = {
  snap: Snapshot | null
  isArmed: boolean
  killing: readonly number[]
  open: Readonly<Record<Section, boolean>>
}
type Actions = {
  refresh: () => Promise<void>
  kill: (roots: number[]) => Promise<void>
  killAll: () => Promise<void>
  toggle: (section: Section) => Promise<void>
}

const idle = async () => {}
const IDLE: Actions = { refresh: idle, kill: idle, killAll: idle, toggle: idle }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
/** Which section a press region asked to toggle, if the message is one of theirs. */
const sectionOf = (data: unknown): Section | null =>
  isRecord(data) && (data.toggle === 'zombies' || data.toggle === 'sessions') ? data.toggle : null

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`
const keyOf = (zombie: Zombie): string => `${zombie.root.pid}:${zombie.root.started}`
const share = (part: number, whole: number): number => (whole > 0 ? part / whole : 0)
/** Whether a scan found nothing new: writing an equal snapshot would only redraw the board for nothing. */
const isSameScan = (a: Snapshot, b: Snapshot): boolean =>
  JSON.stringify({ ...a, scannedAt: 0 }) === JSON.stringify({ ...b, scannedAt: 0 })
const empty = (scannedAt: number): Snapshot => ({
  scannedAt,
  groups: [],
  zombies: [],
  totals: { procs: 0, cpu: 0, rssKb: 0, tokensIn: 0, tokensOut: 0 },
  machine: { cores: 0, memoryKb: 0 },
  error: null,
})

function origin(zombie: Zombie): string {
  switch (zombie.reason) {
    case 'session-ended':
      return 'Session ended'
    case 'no-live-session':
      return 'No session left'
    case 'worktree-deleted':
      return 'Worktree deleted'
  }
}

const lineOf = (proc: Proc, depth: number): Line => ({
  pid: proc.pid,
  cpu: proc.isDefunct ? '-' : `${proc.cpu.toFixed(1)}%`,
  mem: proc.isDefunct ? '-' : memory(proc.rssKb),
  command: `${'  '.repeat(Math.max(0, depth - 1))}${depth > 0 ? '└ ' : ''}${proc.label}${proc.isDefunct ? ' (defunct)' : ''}`,
  isFaint: proc.isDefunct,
})

function zombieCard(els: Common, kit: Kit, zombie: Zombie, view: View, act: Actions): RenderElement {
  const { Box, Button } = els
  const { root, children } = zombie
  const procs = [root, ...children]
  const shown = procs.slice(0, ROWS_SHOWN)
  return (
    <Box key={`zombie-${root.pid}`} flexDirection="column" borderStyle="round" {...CARD.zombie} paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        {kit.header(icons.zombie, zombie.session?.name ?? 'Unknown session', `${origin(zombie)} · ${zombie.place}`)}
        <Box width={ACTION_CELLS} justifyContent="flex-end">
          {view.killing.includes(root.pid) ? (
            kit.pill('killing')
          ) : (
            <Button key={`kill-${root.pid}`} label="🪦 Kill" onPress={() => void act.kill([root.pid])} />
          )}
        </Box>
      </Box>
      {kit.table(shown.map(proc => lineOf(proc, proc.depth)), procs.length - shown.length)}
    </Box>
  )
}

function sessionCard(els: Common, kit: Kit, group: SessionGroup): RenderElement {
  const { Box } = els
  const { session, procs } = group
  const shown = procs.slice(0, ROWS_SHOWN)
  const subtitle = `${session.place} · ${count(session.tokensIn)} / ${count(session.tokensOut)} tokens`
  return (
    <Box key={`session-${session.pid}`} flexDirection="column" borderStyle="round" {...CARD.session} paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        {kit.header(icons.terminal, session.name, subtitle)}
        <Box width={ACTION_CELLS} justifyContent="flex-end">
          {kit.pill(session.status)}
        </Box>
      </Box>
      {procs.length > 0 &&
        kit.table(shown.map(proc => lineOf(proc, proc.depth)), procs.length - shown.length)}
    </Box>
  )
}

function board(els: Common, kit: Kit, view: View, act: Actions): RenderElement {
  const { Box, Button } = els
  const { snap, open } = view
  if (snap === null) return kit.note('Digging up processes…', 'soft')
  const n = zombieTotal(snap.zombies)
  return (
    <Box flexDirection="column" gap={1}>
      {kit.screen(snap)}
      {snap.error !== null && kit.note(snap.error, 'alarm')}
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        {n > 0 ? kit.toggle('zombies', `ZOMBIES · ${n}`, open.zombies) : kit.quiet('ALL QUIET · NO ZOMBIES')}
        {n > 0 && (
          <Button
            key="kill-all"
            label={view.isArmed ? `🪦 Really kill all ${n}?` : '🪦 Kill all'}
            onPress={() => void act.killAll()}
          />
        )}
      </Box>
      {open.zombies && snap.zombies.map(zombie => zombieCard(els, kit, zombie, view, act))}
      <Box flexDirection="row">
        {kit.toggle('sessions', `SESSIONS · ${snap.groups.length}`, open.sessions)}
      </Box>
      {open.sessions && snap.groups.map(group => sessionCard(els, kit, group))}
    </Box>
  )
}

/**
 * The kit for the surface drawing. Decided by `surface`, never by probing the
 * element table: a table answers `in` for elements its surface cannot draw.
 */
function kitOf(surface: RenderSurface, table: Table, columns: number, act: Actions): Kit {
  const cardPx = Math.max(160, (columns - CARD_CHROME) * CELL_PX)
  if (surface !== 'terminal' && 'Svg' in table) {
    const { Svg } = table
    // At its own size: an Svg given none stretches to its slot, text and all.
    const fixed = (drawing: Drawing) => (
      <Svg source={drawing.source} width={drawing.width} height={drawing.height} alt={drawing.alt} />
    )
    return {
      // The screen alone fills the pane's width, scaling as one picture.
      screen: snap => {
        const picture = screen(snap)
        return <Svg source={picture.source} alt={picture.alt} />
      },
      toggle: (section, label, isOpen) => {
        const heading = fixed(strip(section, label, isOpen ? 'open' : 'closed'))
        if (surface !== 'desktop' || !('Client' in table)) {
          const { Button } = table
          return <Button key={`toggle-${section}`} label={`${isOpen ? '⌃' : '⌄'}  ${label}`} onPress={() => void act.toggle(section)} />
        }
        // The drawn strip with a see-through region over it that takes the press (./press.tsx).
        const { Box, Client } = table
        return (
          <Box key={`toggle-${section}`} position="relative">
            {heading}
            <Box position="absolute" top={0} left={0} right={0} bottom={0}>
              <Client key={`press-${section}`} module="./press.tsx" props={{ section }} width="100%" height="100%" />
            </Box>
          </Box>
        )
      },
      quiet: label => fixed(strip('quiet', label, null)),
      note: (message, tone) => fixed(note(message, tone)),
      header: (icon, title, subtitle) => fixed(header(icon, title, subtitle, cardPx - ACTION_CELLS * CELL_PX)),
      table: (lines, more) => fixed(processTable(lines, more, cardPx)),
      pill: status => fixed(pill(status)),
    }
  }
  const { Box, Text, Button } = table
  const width = Math.max(20, columns - CARD_CHROME)
  const bar = (fraction: number) => {
    const lit =
      fraction <= 0 ? 0 : Math.max(1, Math.min(TERMINAL_SEGMENTS, Math.round(fraction * TERMINAL_SEGMENTS)))
    return '▰'.repeat(lit) + '▱'.repeat(TERMINAL_SEGMENTS - lit)
  }
  return {
    screen: snap => {
      const { totals, machine } = snap
      const cells = raster(title())
      return (
        <Box flexDirection="column">
          {'Raster' in table && columns >= cells.columns ? (
            <table.Raster key="title" {...cells} />
          ) : (
            <Text bold color={NIGHT.value}>
              REST IN PID
            </Text>
          )}
          <Text>{`SESSIONS ${snap.groups.length}  PROCESSES ${totals.procs}  ZOMBIES ${zombieTotal(snap.zombies)}`}</Text>
          <Text>{`CPU ${bar(share(totals.cpu, machine.cores * 100))} ${totals.cpu.toFixed(1)}%`}</Text>
          <Text>{`MEM ${bar(share(totals.rssKb, machine.memoryKb))} ${memory(totals.rssKb)}`}</Text>
          <Text dimColor>{`TOKENS ${count(totals.tokensIn)} / ${count(totals.tokensOut)}`}</Text>
        </Box>
      )
    },
    toggle: (section, label, isOpen) => (
      <Button key={`toggle-${section}`} label={`${isOpen ? '⌃' : '⌄'}  ${label}`} onPress={() => void act.toggle(section)} />
    ),
    quiet: label => <Text bold>{label}</Text>,
    note: (message, tone) => (tone === 'alarm' ? <Text color="error">{message}</Text> : <Text dimColor>{message}</Text>),
    header: (_icon, title, subtitle) => (
      <Box flexDirection="column">
        <Text bold>{clip(title, width - ACTION_CELLS)}</Text>
        <Text dimColor>{clip(subtitle, width - ACTION_CELLS)}</Text>
      </Box>
    ),
    table: (lines, more) => (
      <Box flexDirection="column">
        <Text dimColor>{`${'PID'.padStart(6)}  ${'CPU'.padStart(6)}  ${'MEM'.padStart(8)}  COMMAND`}</Text>
        {lines.map(line => (
          <Text dimColor={line.isFaint}>
            {clip(`${String(line.pid).padStart(6)}  ${line.cpu.padStart(6)}  ${line.mem.padStart(8)}  ${line.command}`, width)}
          </Text>
        ))}
        {more > 0 && <Text dimColor>{`${' '.repeat(28)}+ ${more} more`}</Text>}
      </Box>
    ),
    pill: status => <Text bold>{status}</Text>,
  }
}

export const register: Register = on => {
  // Built by session.start around its `$`: the engine takes `$` only spelled out at a call site.
  let actions: Actions | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'rest-in-pid',
      description: 'Show the processes your Claude Code sessions spawned, and lay their zombies to rest',
    })
    const io: Io = {
      run: (argv, init) => $.process.run(argv, init),
      exists: path => $.fs.exists(path),
      list: path => $.fs.list(path),
      read: path => $.fs.read(path),
      stat: path => $.fs.stat(path),
      home: () => $.env.get('HOME'),
      configDir: () => $.env.get('CLAUDE_CONFIG_DIR'),
      settings: () => $.settings.read(),
      now: () => $.clock.now(),
    }
    const readings: Readings = new Map()
    const envs: Envs = new Map()
    // Earlier versions pinned a status line; the band above the prompt says it now.
    $.ui.status(undefined)
    let context: Context | undefined
    let scanning: Promise<Snapshot> | undefined
    let ticks = 0
    let known: ReadonlySet<string> | undefined

    const announce = (snap: Snapshot) => {
      const before = known
      known = new Set(snap.zombies.map(keyOf))
      const risen = before === undefined ? [] : snap.zombies.filter(zombie => !before.has(keyOf(zombie)))
      const first = risen[0]
      if (first === undefined) return
      const total = zombieTotal(risen)
      $.ui.toast(
        total === 1
          ? `A zombie rose in ${first.place}: ${first.root.label}. /rest-in-pid`
          : `${total} zombies rose. /rest-in-pid`,
      )
    }

    /** One scan at a time: a caller arriving mid-scan shares it, so two never read a transcript at once. */
    const scanNow = (self: Context): Promise<Snapshot> =>
      (scanning ??= scan(io, self, readings, envs).finally(() => {
        scanning = undefined
      }))

    const refresh = async () => {
      if (context === undefined) return
      try {
        const found = await scanNow(context)
        const previous = await read($, snapshot)
        if (previous === null || !isSameScan(previous, found)) await update($, snapshot, () => found)
        const total = zombieTotal(found.zombies)
        if ((await read($, zombieCount)) !== total) {
          await update($, zombieCount, () => total)
        }
        announce(found)
      } catch (error) {
        const message = `Scan failed: ${error instanceof Error ? error.message : String(error)}`
        const at = await $.clock.now()
        await update($, snapshot, previous => ({ ...(previous ?? empty(at)), error: message }))
      }
    }

    /** Signals what still runs of these zombies' trees, each pid checked against `ps` once more right before. */
    const signal = async (self: Context, found: Snapshot, zombies: readonly Zombie[], kind: '-TERM' | '-KILL') => {
      const hostPids = found.groups.flatMap(group => (group.session.pid === null ? [] : [group.session.pid]))
      const guard = { selfUid: self.selfUid, protectedPids: new Set([self.selfHostPid, ...hostPids]) }
      const targets = stillSame(killOrder(zombies), await readPs(io, self.os), guard)
      if (targets.length > 0) await $.process.run(['/bin/kill', kind, ...targets.map(String)])
      return targets
    }

    const kill = async (roots: number[]) => {
      const self = context
      const board = await read($, snapshot)
      if (self === undefined || board === null) return
      // The board can be seconds old: judge again, so each tree is taken as it runs now, with the
      // children it spawned since and without what has come to life since.
      const chosen = new Set(board.zombies.filter(zombie => roots.includes(zombie.root.pid)).map(keyOf))
      const found = await scanNow(self)
      const doomed = found.zombies.filter(zombie => chosen.has(keyOf(zombie)))
      const termed = await signal(self, found, doomed, '-TERM')
      if (termed.length === 0) {
        $.ui.toast('Those zombies were already gone.')
        await refresh()
        return
      }
      await update($, killing, list => [...new Set([...list, ...roots])])
      $.clock.after(GRACE_MS, () => {
        void (async () => {
          try {
            // What outlived SIGTERM, and what a dying process spawned: it rose since, in a group just signalled.
            const signalled = doomed
              .flatMap(zombie => [zombie.root, ...zombie.children])
              .filter(proc => termed.includes(proc.pid))
            const outlived = new Set(signalled.map(proc => `${proc.pid}:${proc.started}`))
            const groups = new Set(signalled.map(proc => proc.pgid))
            const before = new Set(found.zombies.map(keyOf))
            const later = await scanNow(self)
            const stubborn = later.zombies.filter(
              zombie => outlived.has(keyOf(zombie)) || (!before.has(keyOf(zombie)) && groups.has(zombie.root.pgid)),
            )
            const killed = await signal(self, later, stubborn, '-KILL')
            const cleared = laidToRest([...doomed, ...stubborn], new Set([...termed, ...killed]))
            $.ui.toast(`Killed ${plural(cleared, 'zombie', 'zombies')}`)
          } finally {
            await update($, killing, list => list.filter(pid => !roots.includes(pid)))
            await refresh()
          }
        })()
      })
    }

    const killAll = async () => {
      if (!(await read($, isArmed))) {
        await update($, isArmed, () => true)
        $.clock.after(ARMED_MS, () => void update($, isArmed, () => false))
        return
      }
      await update($, isArmed, () => false)
      const snap = await read($, snapshot)
      await kill(snap?.zombies.map(zombie => zombie.root.pid) ?? [])
    }

    // One write per atom: the engine lists the state a module writes from its source, so each is named outright.
    const toggle = async (section: Section) => {
      if (section === 'zombies') await update($, zombiesOpen, isOpen => !isOpen)
      else await update($, sessionsOpen, isOpen => !isOpen)
    }

    actions = { refresh, kill, killAll, toggle }
    try {
      context = await contextOf(io)
    } catch (error) {
      const message = `Could not start: ${error instanceof Error ? error.message : String(error)}`
      const at = await $.clock.now()
      await update($, snapshot, () => ({ ...empty(at), error: message }))
    }
    $.clock.every(TICK_MS, () => {
      ticks += 1
      void (async () => {
        const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
        if (isOpen || ticks % SLOW_TICKS === 0) await refresh()
      })()
    })
    // The band shows the count this session's last scan made. Once a zombie it counts is gone,
    // killed in another session or by hand, scan again at once rather than at the slow tick.
    $.clock.every(WATCH_MS, () => {
      void (async () => {
        if (context === undefined || (await read($, zombieCount)) === 0) return
        const counted = (await read($, snapshot))?.zombies.flatMap(zombie => [zombie.root, ...zombie.children]) ?? []
        const running = new Set((await readPs(io, context.os)).map(row => `${row.pid}:${row.started}`))
        if (counted.some(proc => !running.has(`${proc.pid}:${proc.started}`))) await refresh()
      })()
    })
    $.clock.after(1_000, () => void refresh())
    return next(e)
  })

  on('command.run', { command: 'rest-in-pid' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'Rest in PID' })
    await update($, isPlaced, () => opened.isPlaced)
    await actions?.refresh()
    const snap = await read($, snapshot)
    const found =
      snap === null
        ? 'Still digging.'
        : `${plural(zombieTotal(snap.zombies), 'zombie', 'zombies')}, ${plural(snap.totals.procs, 'process', 'processes')} across ${plural(snap.groups.length, 'session', 'sessions')}.`
    return {
      text: opened.isPlaced
        ? `Rest in PID is open. ${found}`
        : `Rest in PID could not place its pane (${opened.reason}). ${found}`,
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const view: View = {
      snap: await read($, snapshot),
      isArmed: await read($, isArmed),
      killing: await read($, killing),
      open: { zombies: await read($, zombiesOpen), sessions: await read($, sessionsOpen) },
    }
    const table = $.ui.resolve(e)
    return board(table, kitOf(e.surface, table, e.props.bodyColumns, actions ?? IDLE), view, actions ?? IDLE)
  })

  on('ui.render', { component: 'CommandOutput', props: { command: 'rest-in-pid' } }, async ($, e, next) => {
    if (await read($, isPlaced)) return next(e)
    const view: View = {
      snap: await read($, snapshot),
      isArmed: await read($, isArmed),
      killing: await read($, killing),
      open: { zombies: await read($, zombiesOpen), sessions: await read($, sessionsOpen) },
    }
    const table = $.ui.resolve(e)
    return board(table, kitOf(e.surface, table, e.viewport?.columns ?? 80, actions ?? IDLE), view, actions ?? IDLE)
  })

  // A press on a section's drawn heading arrives from its see-through region (./press.tsx).
  on('ui.message', async (_, e, next) => {
    const section = sectionOf(e.data)
    if (!e.element.startsWith('press-') || section === null) return next(e)
    await actions?.toggle(section)
    return {}
  })

  // The way in once something rises: the status line is text alone, this band draws the zombie.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const zombies = await read($, zombieCount)
    if (zombies === 0 || e.props.hasSurvey) return next(e)
    const surface = $.ui.resolve(e)
    const { Box, Text, Button } = surface
    const message = `${plural(zombies, 'zombie', 'zombies')} left behind by ended sessions`
    const line = notice(message)
    return (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        {e.surface !== 'terminal' && 'Svg' in surface ? (
          <surface.Svg source={line.source} width={line.width} height={line.height} alt={line.alt} />
        ) : (
          <Text color="error">{message}</Text>
        )}
        <Button
          key="open-graveyard"
          label="Open graveyard"
          onPress={() =>
            void (async () => {
              const opened = await $.ui.open({ id: PANE, title: 'Rest in PID', focus: true })
              await update($, isPlaced, () => opened.isPlaced)
              if (!opened.isPlaced) $.ui.toast(`The pane cannot open here (${opened.reason}). Run /rest-in-pid instead.`)
              await actions?.refresh()
            })()
          }
        />
      </Box>
    )
  })
}
