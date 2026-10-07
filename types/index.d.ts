/** One process on the board: a live session's own, or part of a zombie's tree. */
export type Proc = {
  pid: number
  ppid: number
  /** Its process group, which a child spawned while it dies shares. */
  pgid: number
  /** `ps` lstart in UTC. With `pid` and `command` it is what a kill checks again. */
  started: string
  command: string
  label: string
  cpu: number
  rssKb: number
  isDefunct: boolean
  depth: number
}

export type Session = {
  sessionId: string
  /** The session's host process while it runs; null once it ended. */
  pid: number | null
  name: string
  status: string
  place: string
  tokensIn: number
  tokensOut: number
}

export type SessionGroup = { session: Session; procs: Proc[] }

export type ZombieReason = 'session-ended' | 'no-live-session' | 'worktree-deleted'

export type Zombie = {
  root: Proc
  /** The root's descendants, depth-first. */
  children: Proc[]
  reason: ZombieReason
  session: Session | null
  place: string
}

export type Totals = {
  procs: number
  cpu: number
  rssKb: number
  tokensIn: number
  tokensOut: number
}

/** What the CPU and memory meters measure against; 0 where the host would not say. */
export type Machine = { cores: number; memoryKb: number }

export type Snapshot = {
  scannedAt: number
  groups: SessionGroup[]
  zombies: Zombie[]
  totals: Totals
  machine: Machine
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'rest-in-pid': {
      snapshot: Snapshot | null
      isArmed: boolean
      killing: number[]
      isPlaced: boolean
      zombieCount: number
      zombiesOpen: boolean
      sessionsOpen: boolean
    }
  }
}
