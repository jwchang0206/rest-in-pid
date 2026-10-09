# Changes

## 1.0.2

- Finds a dead session's processes in a worktree again while another
  session runs in the repository's main checkout. 1.0.1 let that session
  adopt the whole tree by its folder, though the processes in it carried the
  dead session's `CLAUDE_PID`, so zombies such as the dev servers a Remote
  Control session left behind went unseen. What a process carries now
  decides before the folder it sits in.

## 1.0.1

- Kill never takes down a live session: what a session runs inside (its
  terminal, a tmux server, an editor) is never a zombie, even when an ended
  session started it.
- `/clear` no longer turns a running session's background processes into
  zombies: a process belongs to the host that spawned it, whichever session
  id it carries.
- Kill judges again when pressed: it spares what has come to life since the
  board was drawn, takes the children spawned since, and its `SIGKILL` pass
  also takes what a dying process spawned in its process group.
- A session in a repository's main checkout counts as working in that
  repository's worktrees, while they exist.
- A shell snapshot older than `cleanupPeriodDays` no longer proves its
  session ended: Claude Code's retention sweep deletes it either way.
- Finds the MCP servers a crashed session left, by the session id they
  inherit.
- Finds leftovers on toolchains kept among system folders: JDKs under
  `/Library/Java`, Xcode's developer tools, and `/usr/lib/jvm` on Linux.
- Reads sessions and transcripts from `CLAUDE_CONFIG_DIR` when it is set.
- Recognizes the user's systemd wherever it is installed, as on NixOS.
- An argument reading `CLAUDE_PID=…` no longer passes for the environment.

## 1.0.0

First release.
