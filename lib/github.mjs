// The GitHub side. One question only: for a branch, is there a pull request
// upstream, and is it draft, open, merged or closed.

import { run } from "./run.mjs";

const FIELDS = "number,state,isDraft,headRefName,headRepositoryOwner";

/**
 * The identity of a branch as GitHub sees it: which account's copy of the
 * repository holds it, and under what name.
 *
 * The owner is not optional. On a repository that takes external contributions,
 * pull requests from forks routinely reuse common branch names, so matching on
 * `headRefName` alone makes a stranger's closed `master` pull request look like
 * yours.
 */
export function headKey(owner, branch) {
  return `${owner.toLowerCase()}\u0000${branch}`;
}

function headKeyBranch(key) {
  return key.slice(key.indexOf("\u0000") + 1);
}

/** GitHub's two fields collapsed into the one state the sidebar shows. */
function classify(pr) {
  if (pr.state === "MERGED") return "merged";
  if (pr.state === "CLOSED") return "closed";
  if (pr.state === "OPEN") return pr.isDraft ? "draft" : "open";
  return null;
}

// A live pull request outranks history. A branch whose first attempt merged and
// whose second attempt is open should read as open, and a closed attempt should
// never hide a merge.
const RANK = { draft: 2, open: 2, merged: 1, closed: 0 };

/**
 * The pull request that describes a branch, from the candidates for it.
 *
 * Highest rank wins; the newest pull request breaks a tie.
 */
export function pickPr(candidates) {
  let best = null;
  for (const candidate of candidates) {
    const state = classify(candidate);
    if (state === null) continue;
    const pr = { state, number: candidate.number };
    if (
      best === null ||
      RANK[pr.state] > RANK[best.state] ||
      (RANK[pr.state] === RANK[best.state] && pr.number > best.number)
    ) {
      best = pr;
    }
  }
  return best;
}

async function ghPrList(args, timeoutMs) {
  const result = await run(["gh", "pr", "list", ...args, "--json", FIELDS], { timeoutMs });
  if (!result.ok) {
    return { ok: false, reason: result.error ?? result.stderr.trim().split("\n")[0] ?? `exit ${result.code}` };
  }
  try {
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed) ? { ok: true, value: parsed } : { ok: false, reason: "unexpected response" };
  } catch {
    return { ok: false, reason: "unparseable response" };
  }
}

/**
 * Head -> pull request for one repository, in as few API calls as possible.
 *
 * `heads` holds `headKey` values. The bulk list is one call for the whole
 * repository regardless of how many Spaces sit on it, which is the difference
 * between 3 calls and 20 on a machine with many worktrees. It is only
 * authoritative when it was not truncated: at exactly `limit` results GitHub may
 * have withheld older pull requests, so each still-unmatched head gets one
 * targeted lookup.
 */
export async function pullRequestsForHeads(repoArg, heads, { limit, timeoutMs }) {
  const byHead = new Map();
  const bulk = await ghPrList([
    "--repo", repoArg,
    "--state", "all",
    "--limit", String(limit),
  ], timeoutMs);
  if (!bulk.ok) return { ok: false, reason: bulk.reason, value: byHead };

  const grouped = new Map();
  for (const pr of bulk.value) {
    const owner = pr?.headRepositoryOwner?.login;
    if (typeof pr?.headRefName !== "string" || typeof owner !== "string") continue;
    const key = headKey(owner, pr.headRefName);
    if (!heads.has(key)) continue;
    const list = grouped.get(key);
    if (list) list.push(pr);
    else grouped.set(key, [pr]);
  }
  for (const [key, candidates] of grouped) {
    const picked = pickPr(candidates);
    if (picked) byHead.set(key, picked);
  }

  if (bulk.value.length < limit) return { ok: true, value: byHead };

  for (const key of heads) {
    if (byHead.has(key)) continue;
    const branch = headKeyBranch(key);
    const targeted = await ghPrList([
      "--repo", repoArg,
      "--head", branch,
      "--state", "all",
      "--limit", "20",
    ], timeoutMs);
    if (!targeted.ok) continue;
    // `--head` filters by branch name only, so the owner check still has to
    // happen here.
    const picked = pickPr(
      targeted.value.filter((pr) => headKey(pr?.headRepositoryOwner?.login ?? "", pr?.headRefName ?? "") === key),
    );
    if (picked) byHead.set(key, picked);
  }
  return { ok: true, value: byHead };
}
