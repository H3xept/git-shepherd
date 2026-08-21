// The Herdr side of the plugin. Herdr's own CLI is the plugin API, and
// HERDR_BIN_PATH points at the running binary, so calling through it works
// identically over a Unix socket and a Windows named pipe.

import { run } from "./run.mjs";

const HERDR = process.env.HERDR_BIN_PATH ?? "herdr";

async function call(argv, timeoutMs) {
  const result = await run([HERDR, ...argv], { timeoutMs });
  if (!result.ok) {
    return { ok: false, reason: result.error ?? result.stderr.trim() ?? `exit ${result.code}` };
  }
  try {
    return { ok: true, value: JSON.parse(result.stdout) };
  } catch {
    return { ok: false, reason: "unparseable response" };
  }
}

/** Every Space, with worktree provenance where Herdr has it. */
export async function workspaceList(timeoutMs = 10000) {
  const response = await call(["workspace", "list"], timeoutMs);
  if (!response.ok) return response;
  const workspaces = response.value?.result?.workspaces;
  if (!Array.isArray(workspaces)) return { ok: false, reason: "no workspaces in response" };
  return { ok: true, value: workspaces };
}

/**
 * First-pane cwd per Space.
 *
 * Only Spaces Herdr recognised as a checkout carry `worktree`, so a plain
 * repository opened as a Space needs its pane's cwd to be locatable at all.
 */
export async function workspaceCwds(timeoutMs = 10000) {
  const response = await call(["pane", "list"], timeoutMs);
  if (!response.ok) return response;
  const panes = response.value?.result?.panes;
  if (!Array.isArray(panes)) return { ok: false, reason: "no panes in response" };
  const cwds = new Map();
  for (const pane of panes) {
    if (cwds.has(pane?.workspace_id)) continue;
    const cwd = pane?.cwd ?? pane?.foreground_cwd;
    if (typeof pane?.workspace_id === "string" && typeof cwd === "string" && cwd.length > 0) {
      cwds.set(pane.workspace_id, cwd);
    }
  }
  return { ok: true, value: cwds };
}

/**
 * Patch one Space's display tokens.
 *
 * `tokens` maps a token name to its value, or to null to clear it. Herdr leaves
 * token names this call does not mention alone, so a report is a patch and not
 * a replacement.
 */
export async function reportMetadata({ workspaceId, source, tokens, ttlMs, seq }, timeoutMs = 10000) {
  const argv = ["workspace", "report-metadata", workspaceId, "--source", source];
  for (const [name, value] of Object.entries(tokens)) {
    if (value === null || value === undefined) argv.push("--clear-token", name);
    else argv.push("--token", `${name}=${value}`);
  }
  if (typeof ttlMs === "number") argv.push("--ttl-ms", String(ttlMs));
  if (typeof seq === "number") argv.push("--seq", String(seq));

  const result = await run([HERDR, ...argv], { timeoutMs });
  return result.ok
    ? { ok: true }
    : { ok: false, reason: result.error ?? result.stderr.trim() ?? `exit ${result.code}` };
}
