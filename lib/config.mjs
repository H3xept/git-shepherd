// Configuration. Values live in `config.json` inside HERDR_PLUGIN_CONFIG_DIR,
// which Herdr creates and never touches; every key is optional.
//
// Colors are deliberately absent. Herdr styles sidebar tokens in the user's own
// config (`fg`, `bold`, `dim` per token occurrence), and a reporter that only
// supplies values cannot fight it. That is why one state maps to one token name
// rather than one shared token carrying a state string: four token names give
// four independently styled colors in a surface that styles per token.

import fs from "node:fs";
import path from "node:path";

export const STATES = ["draft", "open", "merged", "closed"];

const DEFAULTS = {
  // Seconds between full sweeps. GitHub is the rate-limited resource here; one
  // sweep costs one `gh` call per distinct repository, not per Space.
  interval_seconds: 60,
  // Remotes to resolve a Space's repository from, in precedence order. `origin`
  // then `upstream` makes a fork show the pull request it opened upstream.
  remotes: ["origin", "upstream"],
  // Pull requests fetched per repository per sweep. When a repository returns
  // exactly this many the list may be truncated, and unmatched branches get one
  // targeted lookup each.
  gh_limit: 100,
  concurrency: 8,
  // Icon only by default: a Space row is a few dozen columns wide.
  show_number: false,
  token_prefix: "pr",
  // States worth showing. Drop "closed" to ignore abandoned branches.
  states: STATES,
  // Plain Unicode, so no Nerd Font is required.
  icons: { draft: "◌", open: "●", merged: "✔", closed: "✖" },
  // Token TTL as a multiple of the interval. Icons expire on their own if the
  // poller is killed, so a dead poller cannot leave a lie in the sidebar.
  ttl_multiplier: 3,
  // Metadata source id. Herdr scopes clearing and sequencing to it.
  source: "plugin:git-shepherd",
  git_timeout_ms: 5000,
  gh_timeout_ms: 20000,
};

function positiveNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function stringList(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const list = value.filter((item) => typeof item === "string" && item.length > 0);
  return list.length > 0 ? list : fallback;
}

export function stateDir() {
  return process.env.HERDR_PLUGIN_STATE_DIR ?? path.join(process.cwd(), ".state");
}

export function configPath() {
  const dir = process.env.HERDR_PLUGIN_CONFIG_DIR ?? path.join(process.cwd(), ".config");
  return path.join(dir, "config.json");
}

export function loadConfig() {
  let raw = {};
  const file = configPath();
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) raw = {};
  } catch {
    // No config file, or an unreadable one. Defaults are a complete answer, and
    // a background poller that refuses to run because of a stray comma is worse
    // than one that runs with documented defaults.
    raw = {};
  }

  const states = stringList(raw.states, DEFAULTS.states).filter((state) => STATES.includes(state));
  const config = {
    interval_seconds: positiveNumber(raw.interval_seconds, DEFAULTS.interval_seconds),
    remotes: stringList(raw.remotes, DEFAULTS.remotes),
    gh_limit: Math.floor(positiveNumber(raw.gh_limit, DEFAULTS.gh_limit)),
    concurrency: Math.floor(positiveNumber(raw.concurrency, DEFAULTS.concurrency)),
    show_number: typeof raw.show_number === "boolean" ? raw.show_number : DEFAULTS.show_number,
    token_prefix: typeof raw.token_prefix === "string" && /^[A-Za-z0-9_-]{1,24}$/.test(raw.token_prefix)
      ? raw.token_prefix
      : DEFAULTS.token_prefix,
    states: states.length > 0 ? states : DEFAULTS.states,
    icons: { ...DEFAULTS.icons },
    ttl_multiplier: positiveNumber(raw.ttl_multiplier, DEFAULTS.ttl_multiplier),
    source: typeof raw.source === "string" && /^[A-Za-z0-9:._-]{1,80}$/.test(raw.source)
      ? raw.source
      : DEFAULTS.source,
    git_timeout_ms: positiveNumber(raw.git_timeout_ms, DEFAULTS.git_timeout_ms),
    gh_timeout_ms: positiveNumber(raw.gh_timeout_ms, DEFAULTS.gh_timeout_ms),
  };

  if (raw.icons !== null && typeof raw.icons === "object" && !Array.isArray(raw.icons)) {
    for (const state of STATES) {
      if (typeof raw.icons[state] === "string" && raw.icons[state].length > 0) {
        config.icons[state] = raw.icons[state];
      }
    }
  }

  // Herdr expires each token key updated by a report independently, so the TTL
  // only needs to outlive one sweep plus its slowest network call.
  config.ttl_ms = Math.min(86_400_000, Math.max(1, Math.round(config.interval_seconds * config.ttl_multiplier * 1000)));
  // Every state's token name, whether or not the state is enabled: a state that
  // was just disabled still has a stale token to clear.
  config.tokenNames = Object.fromEntries(STATES.map((state) => [state, `${config.token_prefix}_${state}`]));
  return config;
}

/** The sidebar value for one resolved pull request, or null when it is hidden. */
export function tokenValue(config, pr) {
  if (!pr || !config.states.includes(pr.state)) return null;
  const icon = config.icons[pr.state];
  return config.show_number && typeof pr.number === "number" ? `${icon} #${pr.number}` : icon;
}
