<p align="center">
  <img src="icon.svg" width="56" alt="">
</p>

<div align="center">

# dsh-workspace-recency-order

[![](https://img.shields.io/badge/powered_by_dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

</div>

Keeps the DSH sidebar workspace list ordered by the session you used last: the workspace you just sent a message in moves to the top, and a workspace you pin stays there no matter what you use elsewhere — the same behaviour as Codex's project list.

[中文](README.md) | [English](README.en.md)

Why a plugin: the sidebar renders the durable workspace order kept by the Host registry (`workspaceIds`). The browser has no seam for a plugin to sort that list, and the Host offers session-level pinning only, not workspace-level. This plugin maintains that order on the Host and adds the pin switch on the client.

## Install

Install from this local directory (linked into the current profile, not via npm):

```bash
# build first: a link install does not run the build
pnpm install
pnpm run build
```

Then add the directory with **Settings → Plugins → Add plugin**, or let an agent call the plugin manager's `install_bundle` with this directory. Reload the page afterwards (the client half is loaded fresh).

## Use

### Automatic ordering

- Send a message in a session of a workspace → that workspace moves to the top.
- Create a session in a workspace (an empty draft counts) → that workspace moves to the top.
- Other workspaces keep their relative order; workspaces without any activity stay behind each other.
- DSH sorts the list once at startup from stored session history (`sortOnStart`), then events drive it.

**What counts as activity**: human messages in a session (Host event `api-session/activity`, only for `source.kind === 'user'`), plus a session's creation time. Subagent sessions never count; archived sessions' historical time never counts (otherwise the top workspace could show no recent session at all); sessions outside every workspace (ungrouped) never reorder anything.

### Keeping a workspace at the top

A workspace row's «…» menu (or a right click on the row) gains one item:

- **Keep workspace at top** — pins that workspace in front; several pins are allowed and the most recent pin leads.
- **Stop keeping workspace at top** — releases it back to activity order.

**It is a menu item, not an icon button on the row**: the shipped workspace row exposes only its «…» menu for extensions (session rows are the ones with hover-button slots). Drawing an icon on the row would require replacing the whole sidebar workspace browser, which also drops search, drag ordering, the workspace tree, and every dialog.

Notes on pinning:

- The pin list lives in **this browser** (`localStorage`, key `dsh.workspace-recency.pinned-workspaces.v1`); it does not follow you to another device, and pages of the same browser share it.
- The pin is **maintained by the open page**: after each activity sort the page moves pinned workspaces back. While the page is closed nothing corrects the order, and the next page load puts them back.
- Two browsers pinning **different** workspaces fight over the same Host order. After correcting four times within ten seconds the plugin steps aside for 30 seconds and says so once instead of writing forever.
- A refused write rolls the pin back and reports one failure at most once per 30 seconds; a browser that refuses stored settings is told plainly that the pin cannot be remembered.

## Configuration

Override the row's `config` in `cordis.patch.yml` (the whole section is replaced, so restate the fields you want to keep):

| Key | Default | Effect |
| --- | --- | --- |
| `enabled` | `true` | Master switch; `false` registers nothing |
| `sortOnStart` | `true` | Sort once at startup from stored session history |
| `trackNewSessions` | `true` | A new session (draft included) also lifts its workspace |
| `debounceMs` | `600` | Quiet period that merges consecutive activity into one write |

An unknown key or unusable value logs a `warn` on the Host and falls back to the default.

## Trade-offs and limits

- Ordering rewrites the **durable Host order**: a position you drag by hand is overwritten by the next message or a restart. Turn the plugin off in **Settings → Plugins** to keep manual control.
- Only the default **Group by workspace** view is covered; in **Workspace tree** a child workspace stays nested under its parent, so a pinned child leads only among its siblings.
- Each activity triggers at most one sort; every move is one registry write (about 67 KB of JSON on this machine). Nothing is written when the order already matches.
- Pins are not session data: another machine, another browser, or cleared site data starts without them.

## Documents

- [docs/design.md](docs/design.md) — the menu item, icon and toast copy, in full
- [docs/flows.md](docs/flows.md) — what one activity or one click walks through
- [docs/internals.md](docs/internals.md) — the Host surface this plugin uses, and the decision index
- [docs/development.md](docs/development.md) — layout, build, tests, installing into a real profile
- [.agents/notes/](.agents/notes/AGENTS.md) — why each decision was made, and what was rejected

## License

MIT
