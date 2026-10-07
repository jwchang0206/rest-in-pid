import type { Snapshot } from '../types'
import { count, memory, zombieTotal } from './model'
import { ACTORS, ICON_COIN, ICON_GEAR, ICON_TERMINAL, ICON_ZOMBIE, meter, pixels, scene } from './sprites'
import type { Sprite } from './sprites'

/**
 * Everything the board shows, bar its buttons, is drawn here as SVG in one
 * monospace face: the surfaces draw Text in their own proportional font, and
 * no prop changes it.
 */

/** A drawing and the size it is meant to be shown at, in CSS pixels. */
export type Drawing = { source: string; width: number; height: number; alt: string }

/** One process row of a card's table. */
export type Line = { pid: number; cpu: string; mem: string; command: string; isFaint: boolean }

/** The night palette of the screen at the top. */
export const NIGHT = {
  ground: '#1d1934',
  slot: '#2a2448',
  slotFrame: '#3d3570',
  frame: '#4c4480',
  label: '#a99fd0',
  value: '#f3e6c4',
  alarm: '#ff8a7a',
  calm: '#93cf87',
}

/**
 * The pastel palette of the cards and headings. They keep their own colours
 * on either theme, so their ink is their own too.
 */
const DAY = {
  ink: '#3d2f4a',
  soft: '#7d6f8c',
  faint: '#a094b4',
  rule: '#e3dcf2',
  alarm: '#c2413a',
}

/** Badge looks: a session's state, and a zombie being killed. */
const BADGES: Readonly<Record<string, { ink: string; ground: string; mark: string }>> = {
  busy: { ink: '#2c7a4b', ground: '#d4f2dd', mark: '●' },
  running: { ink: '#2c7a4b', ground: '#d4f2dd', mark: '●' },
  waiting: { ink: '#8a5d00', ground: '#ffefc4', mark: '◐' },
  idle: { ink: '#6f6385', ground: '#ebe6f6', mark: '○' },
  killing: { ink: '#8a3a4e', ground: '#ffe0e8', mark: '◌' },
}

/** Section strips: the icon, the tint, and the ink of each. */
type Strip = 'zombies' | 'sessions' | 'quiet'
const STRIPS: Readonly<Record<Strip, { icon: Sprite; ground: string; ink: string }>> = {
  zombies: { icon: ICON_ZOMBIE, ground: '#ffe3ea', ink: '#7a2f45' },
  sessions: { icon: ICON_TERMINAL, ground: '#ebe5ff', ink: '#4a3d7a' },
  quiet: { icon: ICON_ZOMBIE, ground: '#dcf2e3', ink: '#2c6b45' },
}

const MONO = "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace"
/** One monospace column is about 0.6em wide; CJK and emoji take two. */
const ADVANCE = 0.6
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|\p{Extended_Pictographic}/u

/** The screen: the graveyard scene is 128 pixels drawn three times over. */
const SCALE = 3
const SCREEN_W = 384
const BANNER_H = 132
const PAD = 10
const GAP = 8
const SLOT_H = 68
const METER_SEGMENTS = 24
const GAUGE_H = 22
/** A gauge's reading in three fixed stops, so both rows line up at value, slash and total. */
const VALUE_END = 298
const SLASH_AT = 307
const TOTAL_START = 316
const ICON_BOX = 24
const TITLE_SIZE = 13
const SUBTITLE_SIZE = 11
const BODY_SIZE = 12

/**
 * Ambient motion, all of it in CSS inside the drawing: it runs without the mod
 * drawing anything again, and stops for anyone who asked for less motion.
 */
const MOTION =
  '<style>' +
  '.twinkle{animation:twinkle 2.4s steps(1,end) infinite}' +
  '@keyframes twinkle{0%,100%{opacity:1}50%{opacity:.3}}' +
  '.glow{animation:glow 3.2s ease-in-out infinite}' +
  '@keyframes glow{0%,100%{opacity:.2}50%{opacity:1}}' +
  '@media (prefers-reduced-motion:reduce){.twinkle,.glow{animation:none}}' +
  '</style>'

/** The still scene never changes, so it is drawn once. */
const SCENE = pixels(scene(), 0, 0, SCALE)
const fragments = new Map<Sprite, string>()
/** A 12-pixel icon at twice its size, drawn once and placed by translation after that. */
const icon = (sprite: Sprite, x: number, y: number): string => {
  let fragment = fragments.get(sprite)
  if (fragment === undefined) {
    fragment = pixels(sprite, 0, 0, 2)
    fragments.set(sprite, fragment)
  }
  return `<g transform="translate(${x} ${y})">${fragment}</g>`
}

const columnsOf = (text: string): number =>
  [...text].reduce((total, char) => total + (WIDE.test(char) ? 2 : 1), 0)

/** `text` cut to `columns`, an ellipsis standing for the rest. */
export function clip(text: string, columns: number): string {
  if (columnsOf(text) <= columns) return text
  let kept = ''
  let used = 0
  for (const char of text) {
    const width = WIDE.test(char) ? 2 : 1
    if (used + width > columns - 1) break
    kept += char
    used += width
  }
  return `${kept}…`
}

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

type Style = { size: number; fill: string; isBold?: boolean; anchor?: 'start' | 'middle' | 'end'; spacing?: number }

function text(x: number, y: number, content: string, style: Style): string {
  const bold = style.isBold === true ? ' font-weight="bold"' : ''
  const anchor = style.anchor !== undefined && style.anchor !== 'start' ? ` text-anchor="${style.anchor}"` : ''
  const spacing = style.spacing !== undefined ? ` letter-spacing="${style.spacing}"` : ''
  return (
    `<text x="${x}" y="${y}" font-family="${MONO}" font-size="${style.size}" fill="${style.fill}"${bold}${anchor}${spacing}>` +
    `${escape(content)}</text>`
  )
}

const drawing = (width: number, height: number, body: string, alt: string): Drawing => ({
  source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${body}</svg>`,
  width,
  height,
  alt,
})

const share = (part: number, whole: number): number => (whole > 0 ? part / whole : 0)

type Counter = { icon: Sprite; value: string; label: string; tone: string }

/** A slot of the status window: icon over value over label, all on one centre line. */
function slot(x: number, y: number, width: number, counter: Counter): string {
  const centre = x + width / 2
  return (
    `<rect x="${x}" y="${y}" width="${width}" height="${SLOT_H}" rx="8" fill="${NIGHT.slot}" stroke="${NIGHT.slotFrame}"/>` +
    icon(counter.icon, centre - ICON_BOX / 2, y + 9) +
    text(centre, y + 50, counter.value, { size: 17, fill: counter.tone, isBold: true, anchor: 'middle' }) +
    text(centre, y + 62, counter.label, { size: 9, fill: NIGHT.label, anchor: 'middle', spacing: 1 })
  )
}

/** The tokens slot: the coin on the centre line, each figure over its own label, a rule between them. */
function tokens(x: number, y: number, width: number, spentIn: string, spentOut: string): string {
  const centre = x + width / 2
  const halves: Array<[number, string, string]> = [
    [x + width / 4, spentIn, 'TOKENS IN'],
    [x + (width * 3) / 4, spentOut, 'TOKENS OUT'],
  ]
  return (
    `<rect x="${x}" y="${y}" width="${width}" height="${SLOT_H}" rx="8" fill="${NIGHT.slot}" stroke="${NIGHT.slotFrame}"/>` +
    icon(ICON_COIN, centre - ICON_BOX / 2, y + 9) +
    `<rect x="${centre - 0.5}" y="${y + 38}" width="1" height="${SLOT_H - 46}" fill="${NIGHT.slotFrame}"/>` +
    halves
      .map(
        ([middle, value, label]) =>
          text(middle, y + 50, value, { size: 17, fill: NIGHT.value, isBold: true, anchor: 'middle' }) +
          text(middle, y + 62, label, { size: 9, fill: NIGHT.label, anchor: 'middle', spacing: 1 }),
      )
      .join('')
  )
}

/** A meter row: label, segments, then value / total, each on its own stop. */
function gauge(y: number, label: string, fraction: number, value: string, total: string): string {
  const baseline = y + 13
  return (
    text(PAD + 2, baseline, label, { size: 11, fill: NIGHT.label, isBold: true }) +
    pixels(meter(fraction, METER_SEGMENTS), PAD + 36, y + 3, 2) +
    text(VALUE_END, baseline, value, { size: BODY_SIZE, fill: NIGHT.value, isBold: true, anchor: 'end' }) +
    (total === ''
      ? ''
      : text(SLASH_AT, baseline, '/', { size: BODY_SIZE, fill: NIGHT.label, anchor: 'middle' }) +
        text(TOTAL_START, baseline, total, { size: BODY_SIZE, fill: NIGHT.label }))
  )
}

/** What moves over the scene: stars and fireflies, each out of step with the next. */
function actors(): string {
  const offset = (index: number, period: number) => `animation-delay:-${((index * 0.37) % 1) * period}s`
  const stars = ACTORS.stars.map(
    (star, index) =>
      `<g class="twinkle" style="${offset(index, 2.4)}">${pixels(star.sprite, star.x * SCALE, star.y * SCALE, SCALE)}</g>`,
  )
  const flies = ACTORS.fireflies.map(
    (fly, index) =>
      `<g class="glow" style="${offset(index, 3.2)}">${pixels(fly.sprite, fly.x * SCALE, fly.y * SCALE, SCALE)}</g>`,
  )
  return [...stars, ...flies].join('')
}

/** The scene and what moves over it never change, so they are drawn once. */
const BACKDROP = SCENE + actors()

let lastScreen: { key: string; drawing: Drawing } | undefined

/**
 * The graveyard and its status window as one picture, so nothing in it can
 * drift out of line. Built again only when what it shows has changed.
 */
export function screen(snap: Snapshot): Drawing {
  const { totals, machine } = snap
  const zombies = zombieTotal(snap.zombies)
  const key = JSON.stringify([snap.groups.length, zombies, totals, machine])
  if (lastScreen?.key === key) return lastScreen.drawing
  const third = (SCREEN_W - PAD * 2 - GAP * 2) / 3
  const full = SCREEN_W - PAD * 2
  const parts = [BACKDROP]
  let y = BANNER_H + PAD
  const counters: Counter[] = [
    { icon: ICON_TERMINAL, value: String(snap.groups.length), label: 'SESSIONS', tone: NIGHT.value },
    { icon: ICON_GEAR, value: String(totals.procs), label: 'PROCESSES', tone: NIGHT.value },
    { icon: ICON_ZOMBIE, value: String(zombies), label: 'ZOMBIES', tone: zombies > 0 ? NIGHT.alarm : NIGHT.calm },
  ]
  counters.forEach((counter, index) => parts.push(slot(PAD + index * (third + GAP), y, third, counter)))
  y += SLOT_H + GAP + 2
  const cores = machine.cores > 0 ? `${machine.cores} cores` : ''
  const ram = machine.memoryKb > 0 ? memory(machine.memoryKb) : ''
  parts.push(gauge(y, 'CPU', share(totals.cpu, machine.cores * 100), `${totals.cpu.toFixed(1)}%`, cores))
  y += GAUGE_H
  parts.push(gauge(y, 'MEM', share(totals.rssKb, machine.memoryKb), memory(totals.rssKb), ram))
  y += GAUGE_H + GAP
  parts.push(tokens(PAD, y, full, count(totals.tokensIn), count(totals.tokensOut)))
  const height = y + SLOT_H + PAD
  const body =
    MOTION +
    `<defs><clipPath id="screen"><rect width="${SCREEN_W}" height="${height}" rx="12"/></clipPath></defs>` +
    `<g clip-path="url(#screen)"><rect width="${SCREEN_W}" height="${height}" fill="${NIGHT.ground}"/>${parts.join('')}</g>` +
    `<rect x="0.75" y="0.75" width="${SCREEN_W - 1.5}" height="${height - 1.5}" rx="11.5" fill="none" stroke="${NIGHT.frame}" stroke-width="1.5"/>`
  const alt =
    `${snap.groups.length} sessions, ${totals.procs} processes, ${zombies} zombies; ` +
    `CPU ${totals.cpu.toFixed(1)}%, memory ${memory(totals.rssKb)}; ` +
    `tokens ${count(totals.tokensIn)} in, ${count(totals.tokensOut)} out`
  lastScreen = { key, drawing: drawing(SCREEN_W, height, body, alt) }
  return lastScreen.drawing
}

const STRIP_H = 30
const STRIP_PAD = 8
const LABEL_SPACING = 0.5
const CHEVRON_W = 10

/**
 * A section's heading: a tinted strip with its icon and label, and, when the
 * section folds, a chevron at its right end (down while closed, up when open).
 * It reads the same on a light or a dark page.
 */
export function strip(kind: Strip, label: string, fold: 'open' | 'closed' | null): Drawing {
  const look = STRIPS[kind]
  const labelX = STRIP_PAD + ICON_BOX + 10
  // Letter spacing widens every column, so it counts toward the width too.
  const labelW = columnsOf(label) * (TITLE_SIZE * ADVANCE + LABEL_SPACING) - LABEL_SPACING
  const chevronX = labelX + labelW + 14
  const width = Math.ceil((fold === null ? labelX + labelW : chevronX + CHEVRON_W) + STRIP_PAD + 2)
  const middle = STRIP_H / 2
  const chevron =
    fold === null
      ? ''
      : `<path d="M${chevronX} ${fold === 'closed' ? middle - 2 : middle + 2}l${CHEVRON_W / 2} ${fold === 'closed' ? 4 : -4}l${CHEVRON_W / 2} ${fold === 'closed' ? -4 : 4}" ` +
        `fill="none" stroke="${look.ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
  const body =
    `<rect width="${width}" height="${STRIP_H}" rx="8" fill="${look.ground}"/>` +
    icon(look.icon, STRIP_PAD, (STRIP_H - ICON_BOX) / 2) +
    text(labelX, 20, label, { size: TITLE_SIZE, fill: look.ink, isBold: true, spacing: LABEL_SPACING }) +
    chevron
  const state = fold === null ? '' : fold === 'open' ? ', open' : ', closed'
  return drawing(width, STRIP_H, body, `${label}${state}`)
}

/** A line of text on the page: an empty state, an error, a wait. */
export function note(message: string, tone: 'soft' | 'alarm'): Drawing {
  const width = Math.ceil(columnsOf(message) * BODY_SIZE * ADVANCE + 4)
  const fill = tone === 'alarm' ? DAY.alarm : DAY.soft
  return drawing(width, 18, text(0, 13, message, { size: BODY_SIZE, fill }), message)
}

/** A card's head: its icon in a fixed box, so every title starts on the same line, then title over subtitle. */
export function header(sprite: Sprite, title: string, subtitle: string, widthPx: number): Drawing {
  const textX = ICON_BOX + 10
  const room = Math.max(40, widthPx - textX)
  const titleText = clip(title, Math.floor(room / (TITLE_SIZE * ADVANCE)))
  const subtitleText = clip(subtitle, Math.floor(room / (SUBTITLE_SIZE * ADVANCE)))
  const used = Math.max(
    columnsOf(titleText) * TITLE_SIZE * ADVANCE,
    columnsOf(subtitleText) * SUBTITLE_SIZE * ADVANCE,
  )
  const width = Math.ceil(textX + used + 2)
  const body =
    icon(sprite, 0, 6) +
    text(textX, 16, titleText, { size: TITLE_SIZE, fill: DAY.ink, isBold: true }) +
    text(textX, 31, subtitleText, { size: SUBTITLE_SIZE, fill: DAY.soft })
  return drawing(width, 36, body, `${title}. ${subtitle}`)
}

const TABLE_SIZE = 11
const ROW_H = 17
const COLUMNS = [
  { title: 'PID', width: 6 },
  { title: 'CPU', width: 6 },
  { title: 'MEM', width: 8 },
] as const

/** A card's processes: numbers flush right in fixed columns, the command after them, then how many more. */
export function table(lines: readonly Line[], more: number, widthPx: number): Drawing {
  const advance = TABLE_SIZE * ADVANCE
  const gap = 2 * advance
  const edges: number[] = []
  let x = 0
  for (const column of COLUMNS) {
    x += column.width * advance
    edges.push(x)
    x += gap
  }
  const commandX = x
  const commandColumns = Math.max(12, Math.floor((widthPx - commandX) / advance))
  const width = Math.ceil(commandX + commandColumns * advance)
  const head =
    COLUMNS.map((column, index) =>
      text(edges[index] ?? 0, 11, column.title, { size: 9, fill: DAY.faint, anchor: 'end', spacing: 0.5 }),
    ).join('') +
    text(commandX, 11, 'COMMAND', { size: 9, fill: DAY.faint, spacing: 0.5 }) +
    `<rect x="0" y="16" width="${width}" height="1" fill="${DAY.rule}"/>`
  const rows = lines.map((line, index) => {
    const y = 31 + index * ROW_H
    const ink = line.isFaint ? DAY.faint : DAY.ink
    const cells = [String(line.pid), line.cpu, line.mem]
    return (
      cells
        .map((cell, column) => text(edges[column] ?? 0, y, cell, { size: TABLE_SIZE, fill: ink, anchor: 'end' }))
        .join('') + text(commandX, y, clip(line.command, commandColumns), { size: TABLE_SIZE, fill: ink })
    )
  })
  if (more > 0) {
    rows.push(text(commandX, 31 + lines.length * ROW_H, `+ ${more} more`, { size: TABLE_SIZE, fill: DAY.faint }))
  }
  const height = 20 + rows.length * ROW_H
  return drawing(width, height, head + rows.join(''), `${lines.length + more} processes`)
}

/** A badge in a card's right-hand column, every badge as wide as the longest so they line up. */
export function pill(status: string): Drawing {
  const look = BADGES[status] ?? BADGES.idle ?? { ink: DAY.soft, ground: DAY.rule, mark: '○' }
  const label = `${look.mark} ${status}`
  const width = Math.ceil(columnsOf('◐ waiting') * 11 * ADVANCE + 16)
  const body =
    `<rect width="${width}" height="20" rx="10" fill="${look.ground}"/>` +
    text(width / 2, 14, label, { size: 11, fill: look.ink, isBold: true, anchor: 'middle' })
  return drawing(width, 20, body, status)
}

const NOTICE_SIZE = 13
/** Zombie red that reads on a light or a dark prompt band. */
const NOTICE_INK = '#d0584f'

/**
 * The zombie's face and a line of text as one drawing, so the two share a
 * centre line; a Text beside an Svg sits on its own baseline instead.
 */
export function notice(message: string): Drawing {
  const textX = ICON_BOX + 8
  const width = Math.ceil(textX + columnsOf(message) * NOTICE_SIZE * ADVANCE + 2)
  const body = icon(ICON_ZOMBIE, 0, 0) + text(textX, 17, message, { size: NOTICE_SIZE, fill: NOTICE_INK, isBold: true })
  return drawing(width, ICON_BOX, body, message)
}

export const icons = { zombie: ICON_ZOMBIE, terminal: ICON_TERMINAL } as const
