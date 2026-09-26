# Security policy

## Supported versions

Only the latest release receives security fixes.

## Report a vulnerability

Do not open a public issue for a security problem.

Report it privately through
[GitHub security advisories](https://github.com/H3xept/git-shepherd/security/advisories/new).
Include the version, your platform, the steps to reproduce, and the impact you
expect.

The maintainer answers in the advisory. When the fix ships, the advisory is
published and credits you, unless you ask to stay anonymous.

## Scope

The plugin runs `git` and `gh` and talks to the local herdr socket with the
rights of your user. It only reads pull request state; it never writes to
GitHub or to a repository. `install.sh` edits your herdr config only when
`herdr config check` still passes afterwards. A way to make the plugin run a
command it did not name, change a repository, or send your GitHub token
anywhere but GitHub is in scope.
