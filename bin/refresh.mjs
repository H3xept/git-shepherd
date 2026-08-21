#!/usr/bin/env node
// One-shot refresh.
//
//   refresh.mjs                  every Space
//   refresh.mjs --context        only the Space of the invocation (event hooks)
//   refresh.mjs --workspace <id> only that Space
//
// `--context` exists so a worktree that just appeared shows its pull request
// immediately instead of waiting out the poll interval, at the cost of one
// `gh` call rather than a whole sweep.

import { loadConfig } from "../lib/config.mjs";
import { sweep } from "../lib/sweep.mjs";

function targetWorkspace(argv) {
  const explicit = argv.indexOf("--workspace");
  if (explicit !== -1 && argv[explicit + 1]) return argv[explicit + 1];
  if (!argv.includes("--context")) return null;

  // The context JSON is the invocation's own payload, so it wins.
  // HERDR_WORKSPACE_ID is also exported into every Herdr pane, which means a
  // process started from a pane can inherit a workspace id that has nothing to
  // do with this invocation.
  try {
    const context = JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON ?? "{}");
    if (typeof context.workspace_id === "string" && context.workspace_id.length > 0) {
      return context.workspace_id;
    }
  } catch {
    // Unparseable payload; fall through to the environment variable.
  }
  return process.env.HERDR_WORKSPACE_ID ?? null;
}

const argv = process.argv.slice(2);
const workspaceId = targetWorkspace(argv);
if (argv.includes("--context") && workspaceId === null) {
  // An invocation scoped to a Space that Herdr could not name has no target.
  // Sweeping everything instead would turn one cheap hook into a full pass.
  process.stdout.write("no workspace in invocation context\n");
  process.exit(0);
}

const result = await sweep({
  config: loadConfig(),
  only: workspaceId === null ? null : new Set([workspaceId]),
});

if (!result.ok) {
  process.stderr.write(`${result.reason}\n`);
  process.exit(1);
}
process.stdout.write(
  `spaces=${result.spaces} repos=${result.repos} shown=${result.shown} reported=${result.reported}` +
    (result.failures.length > 0 ? ` errors=${result.failures.join("; ")}` : "") +
    "\n",
);
