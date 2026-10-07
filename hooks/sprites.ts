/** A picture as rows of palette keys; `.` is see-through. */
export type Sprite = readonly string[]

/**
 * One moonlit palette. The scene is night on either theme, a framed game
 * screen, so it needs no light and dark pair.
 */
const PALETTE: Readonly<Record<string, string>> = {
  k: '#1c1830', // outline
  K: '#3b2f4f', // brows, scar, mouth, title shadow
  '1': '#15132b', // sky, top band
  '2': '#1b1838',
  '3': '#221e45',
  '4': '#2b2552',
  '5': '#352c5c',
  '6': '#433566', // sky, horizon
  m: '#f7e8a8', // moon
  M: '#fff8d6', // moon rim light
  n: '#cdb56f', // moon inner edge
  y: '#fff3c4', // bright stars
  Y: '#8e86c8', // dim stars
  C: '#5a5196', // moonlit cloud edge
  B: '#3a3370', // cloud wisp
  h: '#211c3f', // far hills
  H: '#2c2650', // far hill rim
  q: '#16122b', // castle
  L: '#ffd36b', // lit window, flame
  t: '#110e22', // bats
  i: '#1d2a3a', // near hills
  I: '#27384a', // near hill rim
  g: '#2f5a48', // grass
  G: '#468a66', // moonlit grass tips
  d: '#3a2e3f', // soil
  D: '#2b2131', // soil specks
  s: '#8e88b0', // stone
  S: '#666088', // stone shade
  w: '#c9c4e6', // stone in moonlight
  f: '#c8f7a8', // fireflies
  z: '#a3d99b', // zombie skin
  e: '#ffffff', // eye shine, fang
  c: '#f2a3b3', // rosy cheeks
  j: '#a9c8f0', // shirt
  x: '#1e3328', // terminal screen
  X: '#9be59a', // phosphor prompt
  v: '#f3e6c4', // title, wax, bone
  V: '#d6c49a', // wax shade
  F: '#f6c453', // coin
  R: '#c98e2c', // coin rim
  p: '#93cf87', // meter fill
  P: '#f6c453', // meter fill, busy
  Q: '#ff8a7a', // meter fill, hot
  u: '#2f2a52', // meter track
  U: '#5b5290', // meter frame
}
const SKY = ['1', '2', '3', '4', '5', '6']
/** Keys a terminal leaves to its own background. */
const BACKDROP = new Set(['.', ...SKY])
const TERMINAL_DEFAULT = 0x01000000

/** A headstone with a carved cross, lit from the moon's side. */
const GRAVE: Sprite = [
  '....kkkkk....',
  '..kksssswkk..',
  '.kSsssSssswk.',
  '.kSssSSSsswk.',
  '.kSsssSssswk.',
  '.kSsssSssswk.',
  '.kSssssssswk.',
  '.kSssssssswk.',
  '.kSssssssssk.',
  '.kSSsssssssk.',
  '.kSSSssssssk.',
  'kkkkkkkkkkkkk',
  'kSSSSSsssswwk',
  'kkkkkkkkkkkkk',
]

/** Up on the hill, the doctor's castle: three spires, one lit window. */
const CASTLE: Sprite = [
  '.......q........',
  '......qqq.......',
  '..q...qqq...q...',
  '.qqq..qLq..qqq..',
  '.qqq.qqqqq.qqq..',
  '.qqqqqqqqqqqqq..',
  '.qqqqqqqqqqqqq..',
  'qqqqqqqqqqqqqqqq',
]

const BAT: Sprite = ['t.....t', 'tt.t.tt', '.ttttt.']
const WISP: Sprite = ['.....CCCCCC.........', '..CCBBBBBBBCCCC.....', '......BBBBBBBBBBBB..']
const TWINKLE: Sprite = ['.y.', 'yyy', '.y.']
const FIREFLY: Sprite = ['f']

/** The icon set: twelve pixels square, outlined, lit from the top left, so any two line up. */
/** The same zombie's face: the mark for whatever was left behind. */
export const ICON_ZOMBIE: Sprite = [
  '....k..k....',
  '..kkkkkkkk..',
  '.kzzzzzKzzk.',
  'kzzzzzKKKzzk',
  'kzeKzzzzeKzk',
  'kzKKzzzzKKzk',
  'kczzzzzzzzck',
  'kzzzzKwKzzzk',
  '.kzzzzzzzzk.',
  '..kkzzzzkk..',
  '...kjjjjk...',
  '..kjjjjjjk..',
]
/** A beige terminal with a green prompt: a Claude Code session at work. */
export const ICON_TERMINAL: Sprite = [
  '.kkkkkkkkkk.',
  'kvvvvvvvvvVk',
  'kvkkkkkkkkVk',
  'kvkxxxxxxkVk',
  'kvkXxxxxxkVk',
  'kvkxXxxxxkVk',
  'kvkXxXXxxkVk',
  'kvkkkkkkkkVk',
  'kVVVVVVVVVVk',
  '.kkkkVVkkkk.',
  '...kVVVVk...',
  '..kkkkkkkk..',
]
/** A cog: a running process. */
export const ICON_GEAR: Sprite = [
  '.....kk.....',
  '..kkkwwkkk..',
  '.kwwkwskssk.',
  '.kwwwsssssk.',
  '.kkwskksskk.',
  'kwwsk..ksSSk',
  'kwssk..kSSSk',
  '.kksskkSSkk.',
  '.kssssSSSSk.',
  '.ksskSSkSSk.',
  '..kkkSSkkk..',
  '.....kk.....',
]
/** A coin: tokens spent. */
export const ICON_COIN: Sprite = [
  '.....kk.....',
  '...kRRRRk...',
  '..kRvvvFRk..',
  '.kRvvvRFFRk.',
  '.RvvvRRFFFR.',
  'kRvvFRRFFFRk',
  'kRvFFRRFFFRk',
  '.RFFFRRFFFR.',
  '.kRFFRRFFRk.',
  '..kRFFFFRk..',
  '...kRRRRk...',
  '.....kk.....',
]
const FONT: Readonly<Record<string, Sprite>> = {
  D: ['####.', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '####.', '#....', '#####'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#'],
  P: ['####.', '#...#', '####.', '#....', '#....'],
  R: ['####.', '#...#', '####.', '#..#.', '#...#'],
  S: ['.####', '#....', '.###.', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..'],
  ' ': ['..', '..', '..', '..', '..'],
}

const BANNER_W = 128
const BANNER_H = 44
const GRASS = 34
const GRAVES = [4, 38, 72, 106]
const STARS: ReadonlyArray<readonly [number, number]> = [
  [66, 3],
  [80, 16],
  [44, 12],
  [123, 21],
]
const SPECKS: ReadonlyArray<readonly [number, number]> = [
  [72, 9],
  [92, 4],
  [56, 13],
  [8, 14],
  [40, 19],
  [100, 22],
  [62, 21],
  [16, 21],
]
const FIREFLIES: ReadonlyArray<readonly [number, number]> = [
  [37, 27],
  [71, 24],
  [104, 29],
  [2, 26],
]

type Canvas = string[][]

const blank = (width: number, height: number, key = '.'): Canvas =>
  Array.from({ length: height }, () => Array.from({ length: width }, () => key))

function paint(canvas: Canvas, x: number, y: number, key: string): void {
  const row = canvas[y]
  if (row !== undefined && x >= 0 && x < row.length) row[x] = key
}

function stamp(canvas: Canvas, sprite: Sprite, left: number, top: number): void {
  sprite.forEach((row, y) => {
    ;[...row].forEach((key, x) => {
      if (key !== '.') paint(canvas, left + x, top + y, key)
    })
  })
}

const flat = (canvas: Canvas): Sprite => canvas.map(row => row.join(''))

/** A fixed 0-99 noise per pixel, so speckles look scattered yet never move between draws. */
const scatter = (x: number, y: number): number => (((x * 73856093) ^ (y * 19349663)) >>> 0) % 100

/** A crescent lit from the right: a disc with an offset disc bitten out of it. */
function crescent(size: number): Sprite {
  const r = size / 2
  const canvas = blank(size, size)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const cx = x + 0.5 - r
      const cy = y + 0.5 - r
      const fromCentre = Math.hypot(cx, cy)
      const fromBite = Math.hypot(cx + 0.45 * r, cy + 0.2 * r)
      const bite = 0.85 * r
      if (fromCentre > r || fromBite <= bite) continue
      const key = fromBite <= bite + 1.2 ? 'n' : r - fromCentre < 1.2 && cx > 0 ? 'M' : 'm'
      paint(canvas, x, y, key)
    }
  }
  return flat(canvas)
}

/** `text` in the 5-pixel font, filled `fill`, outlined in `k` over a one-pixel drop shadow. */
function lettering(text: string, fill: string): Sprite {
  const glyphs = [...text].map(letter => FONT[letter] ?? FONT[' '] ?? [])
  const inner = glyphs.reduce((width, glyph) => width + (glyph[0]?.length ?? 0) + 1, -1)
  const canvas = blank(inner + 3, 5 + 3)
  const ink: Array<[number, number]> = []
  let left = 1
  for (const glyph of glyphs) {
    glyph.forEach((row, y) => {
      ;[...row].forEach((bit, x) => {
        if (bit === '#') ink.push([left + x, 1 + y])
      })
    })
    left += (glyph[0]?.length ?? 0) + 1
  }
  const around = (key: string, shift: number) => {
    for (const [x, y] of ink) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) paint(canvas, x + dx, y + dy + shift, key)
      }
    }
  }
  around('K', 1)
  around('k', 0)
  for (const [x, y] of ink) paint(canvas, x, y, fill)
  return flat(canvas)
}

export const title = (): Sprite => lettering('REST IN PID', 'v')

const farHill = (x: number) => 24 + Math.round(2.5 * Math.sin(x / 10) + 1.5 * Math.sin(x / 4.7))
const nearHill = (x: number) => 29 + Math.round(2 * Math.sin(x / 7 + 1) + 1.5 * Math.sin(x / 3.1))

/** The still part of the graveyard: sky, moon, hills, castle, title, graves and ground. */
export function scene(): Sprite {
  const canvas = blank(BANNER_W, BANNER_H, '6')
  for (let y = 0; y < GRASS; y += 1) {
    const band = Math.min(Math.floor(y / 6), SKY.length - 1)
    for (let x = 0; x < BANNER_W; x += 1) {
      // A dithered seam between bands, as SNES skies were banded.
      const isSeam = band > 0 && y % 6 === 0 && (x + y) % 2 === 0
      paint(canvas, x, y, SKY[isSeam ? band - 1 : band] ?? '6')
    }
  }
  for (const [x, y] of SPECKS) paint(canvas, x, y, 'Y')
  stamp(canvas, crescent(15), 106, 2)
  stamp(canvas, WISP, 94, 12)
  stamp(canvas, BAT, 84, 5)
  stamp(canvas, BAT, 95, 1)
  for (let x = 0; x < BANNER_W; x += 1) {
    const far = farHill(x)
    for (let y = far; y < GRASS; y += 1) paint(canvas, x, y, y === far ? 'H' : 'h')
  }
  stamp(canvas, CASTLE, 90, farHill(97) - CASTLE.length + 1)
  for (let x = 0; x < BANNER_W; x += 1) {
    const near = nearHill(x)
    for (let y = near; y < GRASS; y += 1) paint(canvas, x, y, y === near ? 'I' : 'i')
  }
  stamp(canvas, title(), 4, 3)
  for (const x of GRAVES) stamp(canvas, GRAVE, x, GRASS - GRAVE.length)
  for (let x = 0; x < BANNER_W; x += 1) {
    if (scatter(x, 1) < 35) paint(canvas, x, GRASS - 1, 'G')
    for (let y = GRASS; y < BANNER_H; y += 1) {
      const key =
        y < GRASS + 2 ? (scatter(x, y) < 25 ? 'G' : 'g') : y === GRASS + 2 || scatter(x, y) < 9 ? 'D' : 'd'
      paint(canvas, x, y, key)
    }
  }
  return flat(canvas)
}

/** What moves over the scene, each sprite with where its top-left pixel goes. */
export const ACTORS = {
  stars: STARS.map(([x, y]) => ({ sprite: TWINKLE, x: x - 1, y: y - 1 })),
  fireflies: FIREFLIES.map(([x, y]) => ({ sprite: FIREFLY, x, y })),
}

/** A segmented meter, as a status window draws HP: green, amber past 60%, coral past 85%. */
export function meter(fraction: number, segments: number): Sprite {
  const width = segments * 4 + 3
  const canvas = blank(width, 8, 'u')
  for (let x = 0; x < width; x += 1) {
    paint(canvas, x, 0, 'U')
    paint(canvas, x, 7, 'U')
  }
  for (let y = 0; y < 8; y += 1) {
    paint(canvas, 0, y, 'U')
    paint(canvas, width - 1, y, 'U')
  }
  const lit = fraction <= 0 ? 0 : Math.max(1, Math.min(segments, Math.round(fraction * segments)))
  const fill = fraction > 0.85 ? 'Q' : fraction > 0.6 ? 'P' : 'p'
  for (let segment = 0; segment < segments; segment += 1) {
    for (let y = 2; y < 6; y += 1) {
      for (let dx = 0; dx < 3; dx += 1) paint(canvas, 2 + segment * 4 + dx, y, segment < lit ? fill : 'U')
    }
  }
  return flat(canvas)
}

/**
 * A sprite as SVG paths, one per colour, placed at (x, y) and scaled: what
 * every drawing is built from. One path per colour keeps a whole board far
 * below the 131,072-character Svg cap.
 */
export function pixels(sprite: Sprite, x: number, y: number, scale: number): string {
  const paths = new Map<string, string>()
  sprite.forEach((row, top) => {
    for (let left = 0; left < row.length; ) {
      const key = row[left] ?? '.'
      let run = 1
      while (row[left + run] === key) run += 1
      if (key !== '.') paths.set(key, `${paths.get(key) ?? ''}M${left} ${top}h${run}v1h-${run}z`)
      left += run
    }
  })
  const body = [...paths].map(([key, d]) => `<path fill="${PALETTE[key] ?? '#ff00ff'}" d="${d}"/>`).join('')
  return `<g transform="translate(${x} ${y}) scale(${scale})" shape-rendering="crispEdges">${body}</g>`
}

/** Two pixels per terminal cell: the upper one as a half block's ink, the lower one as its background. */
export function raster(sprite: Sprite): { columns: number; rows: number; cells: string } {
  const columns = sprite[0]?.length ?? 0
  const rows = Math.ceil(sprite.length / 2)
  const colour = (key: string | undefined) =>
    key === undefined || BACKDROP.has(key) ? TERMINAL_DEFAULT : parseInt((PALETTE[key] ?? '#ffffff').slice(1), 16)
  const words = new Uint32Array(columns * rows * 3)
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const top = colour(sprite[y * 2]?.[x])
      const bottom = colour(sprite[y * 2 + 1]?.[x])
      const cell =
        top !== TERMINAL_DEFAULT
          ? [0x2580, top, bottom]
          : bottom !== TERMINAL_DEFAULT
            ? [0x2584, bottom, TERMINAL_DEFAULT]
            : [0x20, TERMINAL_DEFAULT, TERMINAL_DEFAULT]
      words.set(cell, (y * columns + x) * 3)
    }
  }
  let binary = ''
  for (const byte of new Uint8Array(words.buffer)) binary += String.fromCharCode(byte)
  return { columns, rows, cells: btoa(binary) }
}
