// One sweep: Spaces in, sidebar tokens out.
//
// The shape is deliberate. Resolving a Space to a branch is local work, so it
// fans out per Space. Resolving a branch to a pull request is a rate-limited
// network call, so it fans out per *repository*: twenty worktrees of one
// repository cost one API call, not twenty.

import { tokenValue } from "./config.mjs";
import { checkout, repositories } from "./git.mjs";
import { headKey, pullRequestsForHeads } from "./github.mjs";
import * as herdr from "./herdr.mjs";
import { pooled } from "./run.mjs";

/** The directory that represents a Space, or null when it has none. */
function spaceDir(workspace, paneCwds) {
  const checkoutPath = workspace?.worktree?.checkout_path;
  if (typeof checkoutPath === "string" && checkoutPath.length > 0) return checkoutPath;
  return paneCwds.get(workspace.workspace_id) ?? null;
}

/**
 * Refresh pull request tokens.
 *
 * @param config      loaded plugin config
 * @param previous    Map<workspaceId, string|null> of last reported values; mutated
 * @param only        optional Set of workspace ids to limit the sweep to
 */
export async function sweep({ config, previous = new Map(), only = null }) {
  const listed = await herdr.workspaceList();
  if (!listed.ok) return { ok: false, reason: `workspace list failed: ${listed.reason}` };

  const workspaces = listed.value.filter((workspace) => !only || only.has(workspace.workspace_id));

  // Only pay for the pane list when a Space in scope has no worktree provenance.
  let paneCwds = new Map();
  if (workspaces.some((workspace) => !workspace?.worktree?.checkout_path)) {
    const panes = await herdr.workspaceCwds();
    if (panes.ok) paneCwds = panes.value;
  }

  const targets = [];
  for (const workspace of workspaces) {
    const dir = spaceDir(workspace, paneCwds);
    if (dir) targets.push({ workspace, dir });
  }

  // Local: which checkout and branch each Space is on.
  const resolved = await pooled(targets, config.concurrency, async ({ workspace, dir }) => {
    const found = await checkout(dir, config.git_timeout_ms);
    if (!found) return { workspace, repos: [] };
    const repos = await repositories(found.root, config.remotes, config.git_timeout_ms);
    return { workspace, branch: found.branch, repos };
  });

  // Network: one query per repository, covering every head that needs it. A head
  // is an (owner, branch) pair, because a Space's branch only belongs to the
  // accounts its own remotes point at.
  const headsByRepo = new Map();
  for (const entry of resolved) {
    if (!entry.branch) continue;
    const heads = entry.repos.map((repo) => headKey(repo.owner, entry.branch));
    for (const repo of entry.repos) {
      const existing = headsByRepo.get(repo.repoArg);
      const target = existing ?? new Set();
      for (const head of heads) target.add(head);
      if (!existing) headsByRepo.set(repo.repoArg, target);
    }
  }

  const failures = [];
  const prsByRepo = new Map();
  await pooled([...headsByRepo], config.concurrency, async ([repoArg, heads]) => {
    const result = await pullRequestsForHeads(repoArg, heads, {
      limit: config.gh_limit,
      timeoutMs: config.gh_timeout_ms,
    });
    if (!result.ok) failures.push(`${repoArg}: ${result.reason}`);
    prsByRepo.set(repoArg, result.value);
  });

  const reports = [];
  const seenWorkspaces = new Set();
  for (const entry of resolved) {
    const workspaceId = entry.workspace.workspace_id;
    seenWorkspaces.add(workspaceId);

    // Remote precedence: the first base repository that knows one of this
    // Space's heads wins, so a fork reports the pull request it opened upstream.
    let pr = null;
    if (entry.branch) {
      outer: for (const base of entry.repos) {
        const index = prsByRepo.get(base.repoArg);
        if (!index) continue;
        for (const head of entry.repos) {
          const found = index.get(headKey(head.owner, entry.branch));
          if (found) {
            pr = found;
            break outer;
          }
        }
      }
    }

    const value = tokenValue(config, pr);
    // A value is re-reported every sweep to refresh its TTL; a cleared Space has
    // nothing to keep alive, so it is only reported when it changes. That keeps
    // steady-state cost proportional to Spaces that actually show an icon.
    if (value === null && previous.get(workspaceId) === null) continue;

    reports.push({ workspaceId, value, state: pr?.state ?? null, branch: entry.branch ?? null });
  }

  await pooled(reports, config.concurrency, async (report) => {
    const tokens = {};
    for (const [state, name] of Object.entries(config.tokenNames)) {
      tokens[name] = report.state === state ? report.value : null;
    }
    const result = await herdr.reportMetadata({
      workspaceId: report.workspaceId,
      source: config.source,
      tokens,
      // A cleared Space needs no expiry; an icon expires so a dead poller cannot
      // leave a stale pull request state on screen.
      ttlMs: report.value === null ? undefined : config.ttl_ms,
    });
    if (result.ok) previous.set(report.workspaceId, report.value);
    else failures.push(`${report.workspaceId}: ${result.reason}`);
  });

  for (const workspaceId of [...previous.keys()]) {
    if (!seenWorkspaces.has(workspaceId) && !only) previous.delete(workspaceId);
  }

  return {
    ok: true,
    spaces: resolved.length,
    repos: headsByRepo.size,
    shown: reports.filter((report) => report.value !== null).length,
    reported: reports.length,
    failures,
  };
}

/** Clear this plugin's tokens from every Space. */
export async function clearAll(config) {
  const listed = await herdr.workspaceList();
  if (!listed.ok) return { ok: false, reason: listed.reason };
  const tokens = Object.fromEntries(Object.values(config.tokenNames).map((name) => [name, null]));
  await pooled(listed.value, config.concurrency, (workspace) =>
    herdr.reportMetadata({ workspaceId: workspace.workspace_id, source: config.source, tokens }),
  );
  return { ok: true, cleared: listed.value.length };
}
