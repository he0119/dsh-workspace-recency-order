<p align="center">
  <img src="icon.svg" width="56" alt="">
</p>

<div align="center">

# dsh-workspace-recency-order

[![](https://img.shields.io/badge/powered_by_dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

</div>

Keeps the DSH sidebar workspace list ordered by the session you used last: the workspace you just sent a message in moves to the top, and a workspace you pin stays there no matter what you use elsewhere — the same behaviour as Codex's project list.

[中文](README.md) | [English](README.en.md)

Why a plugin: the sidebar renders the durable workspace order kept by the Host registry (`workspaceIds`). The browser has no seam for a plugin to sort that list, and the Host offers session-level pinning only, not workspace-level. This plugin maintains that order on the Host; the client half only owns the menu and the pin list's read/write.

## Install

Open **Settings → Plugins → Add plugin** and enter the package name
`@he0119/dsh-workspace-recency-order`, or let an agent call the plugin manager's `install_bundle` with that
package name. Reload the page afterwards (the client half is loaded fresh).

When you work on this plugin, install this checkout into the development profile you are using (it is
recorded as `link:`):

```bash
pnpm install        # runs prepare (builds lib/), so the artifacts are there when it finishes
```

A local directory install never builds, so run the step above first; after that a new `pnpm run build` takes
effect without reinstalling.

Do **not** install from the GitHub URL or a `github:` spec: the built artifacts in `lib/` are not committed
(they are in `.gitignore`), so a git install arrives without its entry files and fails to load.

## Use

### Automatic ordering

- Send a message in a session of a workspace → that workspace moves to the top.
- Create a session in a workspace (an empty draft counts) → that workspace moves to the top.
- Other workspaces keep their relative order; workspaces without any activity stay behind each other.
- DSH sorts the list once at startup from stored session history (`sortOnStart`), then events drive it.

**What counts as activity**: human messages in a session (Host event `api-session/activity`, only for `source.kind === 'user'`), plus a session's creation time. Subagent sessions never count; archived sessions' historical time never counts (otherwise the top workspace could show no recent session at all); sessions outside every workspace (ungrouped) never reorder anything.

### Pinning a workspace

A workspace row's «…» menu (or a right click on the row) gains one item:

- **Pin** — puts that workspace in the leading group; several pins are allowed, and the group itself is ordered by recent messages too, so the pinned workspace you used last leads it.
- **Unpin** — releases it straight back to its activity position.

**It is a menu item, not an icon button on the row**: the shipped workspace row exposes only its «…» menu for extensions (session rows are the ones with hover-button slots). Drawing an icon on the row would require replacing the whole sidebar workspace browser, which also drops search, drag ordering, the workspace tree, and every dialog.

Notes on pinning:

- The order has **exactly one writer: the Host**. Clicking pin only tells the Host which workspaces are pinned (`POST /api/workspace-recency/pins`), and the Host keeps them in front. Pins therefore never get pushed down and bounced back after an activity, and they keep working while the page is closed.
- The pin list lives on the Host: `<DSH_HOME>/workspace-recency-order/pins.json` (default `~/.dsh/workspace-recency-order/pins.json`). Every browser on this machine sees the same list and re-reads it when you return to the page.
- Pins only occupy the leading group and never push the workspace you just used further down: activity in another workspace places it below the group, and the group itself does not move.
- A refused write reports one failure and then trusts the Host's answer; nothing pretends to have worked.

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

- Ordering rewrites the **durable Host order**: a position you drag by hand is overwritten by the next message or a restart, including inside the pinned group (which is ordered by recent messages). Turn the plugin off in **Settings → Plugins** to keep manual control.
- Only the default **Group by workspace** view is covered; in **Workspace tree** a child workspace stays nested under its parent, so a pinned child leads only among its siblings.
- Each activity triggers at most one sort; every move is one registry write (about 67 KB of JSON on this machine). Nothing is written when the order already matches.
- The pin list is not session data: it lives in the `pins.json` above, follows this machine's `DSH_HOME`, and deleting that file clears every pin.

## Documents

- [docs/design.md](docs/design.md) — the menu item, icon and toast copy, in full
- [docs/flows.md](docs/flows.md) — what one activity or one click walks through
- [docs/internals.md](docs/internals.md) — the Host surface this plugin uses, and the decision index
- [docs/development.md](docs/development.md) — layout, build, tests, installing into a real profile
- [docs/releasing.md](docs/releasing.md) — publishing: package name and scope, the manual first release, the tag checks
- [.agents/notes/](.agents/notes/AGENTS.md) — why each decision was made, and what was rejected

## License

MIT
