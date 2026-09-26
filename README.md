<div align="center">

# git shepherd

**Does this branch have a pull request upstream? Answered in the Herdr sidebar, for every Space at once.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Herdr](https://img.shields.io/badge/herdr-%E2%89%A50.8.0-6e5494.svg)](https://herdr.dev)
[![Dependencies](https://img.shields.io/badge/dependencies-none-brightgreen.svg)](#requirements)

</div>

A Herdr plugin that puts one icon next to every Space showing whether the branch
that Space sits on has a pull request upstream, and whether it is draft, open,
merged, or closed.

```
● COM-1505 ●             open
● COM-1507 ●             open
● static-analysis ◌      draft
● windows-docs-path ✔    merged
● clickhouse-nats        no pull request
```

Twenty worktrees stop being twenty tab-switches and a `gh pr view` each.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/H3xept/git-shepherd/main/install.sh | bash
```

The script checks your dependencies, installs the plugin, offers to add the
sidebar rows, and starts the poller. It keeps a config edit only if
`herdr config check` still passes, and never rewrites a sidebar layout you
already have.

The plugin runs as your user, with your environment and the full herdr CLI.
Read `install.sh` before you pipe it to `bash`. `herdr plugin install` shows
the manifest and every command it runs before it installs; pin a revision with
`--ref <tag-or-sha>` if you want one. See herdr's
[trust and security guidance](https://herdr.dev/docs/plugins/#trust-and-security)
and [SECURITY.md](SECURITY.md).

<details>
<summary>Manual install</summary>

```bash
herdr plugin install H3xept/git-shepherd
```

Then add the tokens to your Space sidebar rows in
`~/.config/herdr/config.toml`. **Nothing appears until you do**: the plugin
reports values, and Herdr decides where and how they render.

```toml
[ui.sidebar.spaces]
rows = [
  [
    "state_icon",
    "workspace",
    { token = "$pr_draft",  fg = "#9198a1" },
    { token = "$pr_open",   fg = "#3fb950" },
    { token = "$pr_merged", fg = "#a371f7" },
    { token = "$pr_closed", fg = "#f85149" },
  ],
]
```

Apply it and start the poller:

```bash
herdr config check
herdr server reload-config
herdr plugin action invoke h3xept.git-shepherd.start
```

</details>

After the first start the poller comes back on its own. Herdr runs the plugin's
startup hook whenever it restores a session or hands off to a new server, which
is exactly when the icons need repopulating, because Space tokens do not survive
a server restart.

### Requirements

- Herdr 0.8.0 or newer
- `node` 18 or newer — builtins only, nothing to install
- `git`
- `gh`, authenticated (`gh auth status`)

### Why four tokens instead of one

Herdr styles a sidebar token per occurrence, so one token can only ever carry
one color. Four token names give four independently colored states. Exactly one
of them is ever set for a Space, and Herdr drops missing values along with their
separators, so only the relevant icon renders.

## Icons

| State  | Default | Meaning                             |
| ------ | ------- | ----------------------------------- |
| draft  | `◌`     | pull request open, marked draft     |
| open   | `●`     | pull request open and ready         |
| merged | `✔`     | pull request merged                 |
| closed | `✖`     | pull request closed without merging |

The defaults are plain Unicode, so no Nerd Font is required. A Space with no
pull request shows nothing.

## Configuration

Optional. Create `config.json` in the plugin's config directory:

```bash
herdr plugin config-dir h3xept.git-shepherd
```

Every key is optional; the values below are the defaults.

```json
{
  "interval_seconds": 60,
  "remotes": ["origin", "upstream"],
  "gh_limit": 100,
  "concurrency": 8,
  "show_number": false,
  "token_prefix": "pr",
  "states": ["draft", "open", "merged", "closed"],
  "icons": { "draft": "◌", "open": "●", "merged": "✔", "closed": "✖" },
  "ttl_multiplier": 3,
  "source": "plugin:git-shepherd",
  "git_timeout_ms": 5000,
  "gh_timeout_ms": 20000
}
```

- `show_number: true` renders `● #1505` instead of `●`. A Space row is narrow, so
  it is off by default.
- `states` drops states you do not want. Removing `"closed"` ignores abandoned
  branches.
- `token_prefix` renames the tokens; `"gh"` gives `$gh_draft`, `$gh_open`, and so
  on. Keep it in step with your sidebar rows.
- `remotes` is precedence order. `origin` then `upstream` is what makes a fork
  report the pull request it opened against the canonical repository.
- `icons` takes anything your font renders, including Nerd Font glyphs.

## Actions

| Action                            | Effect                                       |
| --------------------------------- | -------------------------------------------- |
| `h3xept.git-shepherd.refresh`     | Sweep every Space once, now                  |
| `h3xept.git-shepherd.start`       | Start the poller if it is not already running |
| `h3xept.git-shepherd.stop`        | Stop the poller and clear the icons          |

Bind the refresh to a key if you want it on demand:

```toml
[[keys.command]]
key = "prefix+p"
type = "plugin_action"
command = "h3xept.git-shepherd.refresh"
description = "refresh pull request icons"
```

## How it decides

For each Space the plugin takes the worktree checkout path Herdr reports, or the
first pane's working directory when Herdr has no worktree provenance for it, and
resolves the checkout root and current branch. A detached HEAD has no pull
request and is skipped.

A branch is then identified as a *head*: the pair of the branch name and the
account that owns the repository the branch lives in. The owner is not optional.
On any repository that takes external contributions, pull requests from forks
routinely reuse common branch names, so matching on the branch name alone makes
a stranger's closed `master` pull request look like yours. This was a real bug
during development, and it is why `headRepositoryOwner` is part of the key.

When several pull requests share a head, a live one wins over history: open or
draft beats merged, merged beats closed, and the newest breaks a tie.

### Cost

One sweep costs one `gh pr list` call **per repository**, not per Space. Twenty
worktrees of one repository are one API call. When a repository returns exactly
`gh_limit` results the list may have been truncated, so each still-unmatched head
gets one targeted lookup; below the limit, absence is authoritative and no extra
call happens.

Reporting is diffed. A Space showing an icon is re-reported every sweep to
refresh its token TTL; a Space showing nothing is reported only when it changes.
Steady-state cost is therefore proportional to the Spaces that actually display
something, not to the number of Spaces you have.

### If the poller dies

Every reported token carries a TTL of three intervals. Herdr expires it on its
own, so a killed poller takes its icons down with it rather than leaving a stale
pull request state on screen. The poller also exits by itself after three
consecutive failures to reach the Herdr server, because the startup hook will
start a fresh one for the next server.

## Troubleshooting

```bash
herdr plugin log list --plugin h3xept.git-shepherd   # what Herdr ran, and its output
```

The poller writes its own log next to its pid file in the plugin's state
directory, which the `start` action prints. On Linux and macOS that is
`~/.local/state/herdr/plugins/h3xept.git-shepherd/poller.log`.

Run a sweep in the foreground to see errors directly:

```bash
cd /path/to/git-shepherd && node bin/refresh.mjs
```

Common causes of a missing icon:

- The tokens are not in `[ui.sidebar.spaces] rows`. Herdr renders only what the
  layout asks for.
- `gh auth status` fails, or the repository is private and the token lacks access.
- The Space is on the default branch, which usually has no pull request.
- The branch exists only locally and was never pushed.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for
the development loop, and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for the
ground rules.

## License

[MIT](LICENSE) © Leonardo Cascianelli
