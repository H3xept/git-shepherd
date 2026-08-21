#!/usr/bin/env bash
#
# git-shepherd installer.
#
#   curl -fsSL https://raw.githubusercontent.com/H3xept/git-shepherd/main/install.sh | bash
#
# Installing the plugin is one command on its own. This script exists for the
# second half, which no plugin can do for itself: git-shepherd reports values,
# and Herdr decides whether to render them. Until the `$pr_*` tokens appear in
# your Space sidebar rows, a correctly installed plugin shows nothing at all.
#
# So this script installs the plugin, then offers to add those rows, and only
# keeps the edit if `herdr config check` still passes. It never overwrites rows
# you already have; if a layout is already configured it prints the snippet and
# lets you place it yourself.
#
# Re-running is safe.

set -euo pipefail

REPO="H3xept/git-shepherd"
PLUGIN_ID="h3xept.git-shepherd"
LINK_MODE=0

for arg in "$@"; do
  case "$arg" in
    --link) LINK_MODE=1 ;;
    -h|--help)
      sed -n '3,17p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      printf 'unknown option: %s\n' "$arg" >&2
      exit 2
      ;;
  esac
done

# Colors only when a human is watching.
if [ -t 1 ]; then
  BOLD=$(printf '\033[1m'); DIM=$(printf '\033[2m'); RED=$(printf '\033[31m')
  GREEN=$(printf '\033[32m'); YELLOW=$(printf '\033[33m'); RESET=$(printf '\033[0m')
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; RESET=""
fi

step() { printf '%s==>%s %s\n' "$BOLD" "$RESET" "$1"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$1"; }
die()  { printf '  %s✗%s %s\n' "$RED" "$RESET" "$1" >&2; exit 1; }
hint() { printf '    %s%s%s\n' "$DIM" "$1" "$RESET"; }

# A piped script owns stdin, so prompts have to read the terminal directly.
ask() {
  local prompt="$1" reply=""
  if [ ! -t 1 ] || [ ! -r /dev/tty ]; then return 1; fi
  printf '  %s [y/N] ' "$prompt" > /dev/tty
  read -r reply < /dev/tty || return 1
  case "$reply" in [yY]|[yY][eE][sS]) return 0 ;; *) return 1 ;; esac
}

# ---------------------------------------------------------------- preflight

step "Checking requirements"

command -v herdr >/dev/null 2>&1 || die "herdr not found on PATH. See https://herdr.dev"
ok "herdr $(herdr --version 2>/dev/null | head -1 || echo '(version unknown)')"

command -v git >/dev/null 2>&1 || die "git not found on PATH"
ok "git"

command -v node >/dev/null 2>&1 || die "node not found on PATH (18 or newer required)"
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)'; then
  die "node $(node --version) is too old; 18 or newer required"
fi
ok "node $(node --version)"

command -v gh >/dev/null 2>&1 || die "gh not found on PATH. See https://cli.github.com"
if gh auth status >/dev/null 2>&1; then
  ok "gh authenticated"
else
  # Not fatal: the plugin degrades to reporting nothing, and `gh auth login`
  # afterwards needs no reinstall.
  warn "gh is present but not authenticated; icons stay hidden until it is"
  hint "gh auth login"
fi

# ------------------------------------------------------------------ install

step "Installing the plugin"

if herdr plugin list 2>/dev/null | grep -q "$PLUGIN_ID"; then
  ok "already registered ($PLUGIN_ID)"
  hint "herdr plugin uninstall $PLUGIN_ID   # to start over"
elif [ "$LINK_MODE" -eq 1 ]; then
  here=$(cd -- "$(dirname -- "$0")" && pwd)
  [ -f "$here/herdr-plugin.toml" ] || die "--link needs to run from a git-shepherd checkout"
  herdr plugin link "$here" >/dev/null || die "herdr plugin link failed"
  ok "linked from $here"
else
  herdr plugin install "$REPO" -y >/dev/null || die "herdr plugin install $REPO failed"
  ok "installed from $REPO"
fi

# ------------------------------------------------------------------- config

step "Checking your Space sidebar layout"

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/herdr"
CONFIG="$CONFIG_DIR/config.toml"

ROWS_SNIPPET=$(cat <<'TOML'
[ui.sidebar.spaces]
# git-shepherd reports one token per pull request state, because Herdr styles a
# sidebar token per occurrence and a single token could only ever carry one
# color. Exactly one of the four is set for a Space, and Herdr drops missing
# values along with their separators, so only the relevant icon renders.
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
TOML
)

configured=0

if [ -f "$CONFIG" ] && grep -q '[$]pr_open' "$CONFIG"; then
  ok "tokens already present in $CONFIG"
  configured=1
elif [ -f "$CONFIG" ] && grep -q '^\[ui\.sidebar\.spaces\]' "$CONFIG"; then
  # A layout is already configured. Rewriting someone's rows is not this
  # script's business, and there is no safe automatic merge.
  warn "you already have a [ui.sidebar.spaces] layout, so nothing was changed"
  printf '\n  Add these four tokens to a row in %s:\n\n' "$CONFIG"
  # Taken from the snippet itself, so the two can never drift apart.
  printf '%s\n' "$ROWS_SNIPPET" | grep 'token ='
  printf '\n'
else
  printf '  No Space sidebar layout is configured, so the icons have nowhere to go.\n'
  printf '  This appends the following to %s:\n\n' "$CONFIG"
  printf '%s\n' "$ROWS_SNIPPET" | sed 's/^/    /'
  printf '\n'
  if ask "Append it?"; then
    mkdir -p "$CONFIG_DIR"
    backup=""
    if [ -f "$CONFIG" ]; then
      backup="$CONFIG.git-shepherd.bak"
      cp "$CONFIG" "$backup"
      printf '\n' >> "$CONFIG"
    else
      touch "$CONFIG"
    fi
    printf '%s\n' "$ROWS_SNIPPET" >> "$CONFIG"

    # Herdr validates its own config far better than a grep can, so let it.
    if herdr config check >/dev/null 2>&1; then
      ok "appended to $CONFIG"
      [ -n "$backup" ] && hint "previous config saved at $backup"
      configured=1
    else
      if [ -n "$backup" ]; then
        mv "$backup" "$CONFIG"
        die "herdr rejected the resulting config; your original was restored"
      fi
      rm -f "$CONFIG"
      die "herdr rejected the generated config; nothing was kept"
    fi
  else
    warn "skipped; the plugin runs but stays invisible until those rows exist"
    hint "$CONFIG"
  fi
fi

# -------------------------------------------------------------------- start

step "Starting"

if [ "$configured" -eq 1 ]; then
  if herdr server reload-config >/dev/null 2>&1; then
    ok "config reloaded"
  else
    warn "could not reload config; restart Herdr to pick it up"
  fi
fi

if herdr plugin action invoke "$PLUGIN_ID.start" >/dev/null 2>&1; then
  # `start` is idempotent, so this covers both "launched it" and "already up".
  ok "poller running"
else
  # No running server is the common cause, and the startup hook covers it.
  warn "could not start the poller now; it starts with your next Herdr session"
fi

printf '\n'
if [ "$configured" -eq 1 ]; then
  printf '%sDone.%s Icons appear within a minute: %s draft, %s open, %s merged, %s closed.\n' \
    "$BOLD" "$RESET" "◌" "●" "✔" "✖"
else
  printf '%sPlugin installed.%s Add the sidebar rows above to see anything.\n' "$BOLD" "$RESET"
fi
printf '%sReadme:%s https://github.com/%s\n' "$DIM" "$RESET" "$REPO"
