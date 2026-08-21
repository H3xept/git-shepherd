# Contributing to git-shepherd

Thanks for taking a look. This is a small, deliberately boring plugin, and the
goal is to keep it that way.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you write code

Open an issue first for anything beyond an obvious fix. A short description of
the behavior you want and why beats a surprise pull request, because the answer
is sometimes "that belongs in your `config.json`" or "Herdr should do that".

Good first contributions:

- A `git`/`gh` remote form the URL parser mishandles.
- A pull request state combination that classifies wrong.
- Platform breakage on Windows, which gets the least real-world use here.

## Development setup

There is no build step and no dependency install. You need `node` 18+, `git`,
an authenticated `gh`, and Herdr 0.8.0+.

```bash
git clone git@github.com:H3xept/git-shepherd.git
cd git-shepherd
herdr plugin link "$PWD"
```

`link` points Herdr at your checkout, so edits take effect on the next
invocation. Uninstall a released copy first if you have one, because a plugin id
can only be registered once.

Run a sweep in the foreground to see what it does:

```bash
node bin/refresh.mjs
```

Scope it to one Space, which is the path event hooks take:

```bash
HERDR_PLUGIN_CONTEXT_JSON='{"workspace_id":"w1"}' node bin/refresh.mjs --context
```

Point the plugin at throwaway state instead of your real Herdr directories while
experimenting:

```bash
HERDR_PLUGIN_STATE_DIR=/tmp/gs-state HERDR_PLUGIN_CONFIG_DIR=/tmp/gs-config \
  node bin/refresh.mjs
```

## Checks

```bash
for f in bin/*.mjs lib/*.mjs; do node --check "$f" || exit 1; done
```

That is the whole automated gate, and CI runs exactly it. There is no test suite
on purpose: almost every line here is a call into `git`, `gh`, or Herdr, so a
mocked test would assert that the mocks were written correctly. Verify behavior
against a live session instead, and say in the pull request what you observed.

For a change to classification or lookup, include the evidence:

```bash
herdr workspace list | node -e '…'          # tokens that landed
herdr plugin log list --plugin h3xept.git-shepherd
```

## Pull requests

- One concern per pull request.
- Say what you ran and what you saw. "Verified on 25 Spaces across 7
  repositories, draft and merged both render" is the useful kind of description.
- Note any new API call in the description. Call volume is a feature of this
  plugin, and a change from one call per repository to one per Space is a
  regression even when the icons look identical.
- Update the README when you change configuration keys or defaults.

## Code conventions

- Node builtins only. A dependency needs a real argument, because "no install
  step" is a headline feature.
- Comments explain *why*. The `what` is readable from the code, and the
  non-obvious reasoning is what saves the next person.
- Every external command goes through `lib/run.mjs`. It owns timeouts and
  argv-only invocation, so nothing in this plugin builds a shell string.
- A failed subprocess is data, not an exception. Return `{ ok: false, reason }`
  and let the caller decide.
- Never let one broken Space break a sweep. A repository that fails to resolve
  should cost that repository its icons and nothing more.

## Releasing

Maintainer only. Bump `version` in `herdr-plugin.toml`, tag the commit, and push
the tag. Herdr installs from the default branch, so the tag is a marker for
humans rather than an install target.
