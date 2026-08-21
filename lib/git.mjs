// Git facts about a Space's directory: which checkout it is, which branch it is
// on, and which GitHub repository that checkout pushes to.

import { run } from "./run.mjs";

// Remote URLs are cached per checkout root for the life of the process. A branch
// changes whenever someone runs `git checkout`, so it is never cached; a remote
// effectively never changes, and caching it halves the git spawns per sweep
// after the first one.
const remoteCache = new Map();

/**
 * The checkout root and current branch for `dir`.
 *
 * One `git rev-parse` answers both. A detached HEAD reports the branch as
 * "HEAD", which cannot have a pull request, so it resolves to null.
 */
export async function checkout(dir, timeoutMs) {
  const result = await run(["git", "-C", dir, "rev-parse", "--abbrev-ref", "HEAD", "--show-toplevel"], {
    timeoutMs,
  });
  if (!result.ok) return null;
  const lines = result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const [branch, root] = lines;
  if (branch === "HEAD") return null;
  return { root, branch };
}

/**
 * owner/name (host-qualified when it is not github.com) from a remote URL.
 *
 * Handles ssh, https and scp-style URLs. A local path or a file:// remote is not
 * a GitHub repository and resolves to null rather than to a bogus slug built
 * from the last two path segments.
 */
export function parseRemoteUrl(url) {
  const raw = String(url).trim().replace(/\.git$/, "");
  if (raw.length === 0) return null;
  if (/^file:\/\//i.test(raw)) return null;
  if (/^([A-Za-z]:[\\/]|[\\/]|~|\.)/.test(raw)) return null;

  let rest = raw.replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//, "");
  rest = rest.replace(/^[^@/]*@/, "");
  const match = rest.match(/^([^:/]+)[:/](.+)$/);
  if (!match) return null;

  const host = match[1];
  const segments = match[2].split("/").filter(Boolean);
  if (segments.length < 2) return null;
  const owner = segments[segments.length - 2];
  const slug = `${owner}/${segments[segments.length - 1]}`;
  // `gh --repo` takes [HOST/]OWNER/REPO, which is how a GitHub Enterprise host
  // stays addressable without extra configuration.
  return { host, owner, slug, repoArg: host.toLowerCase() === "github.com" ? slug : `${host}/${slug}` };
}

/**
 * Every configured remote in `remotes` that resolves to a GitHub repository,
 * deduplicated, in the order given.
 *
 * The order is the precedence used later: a fork's own `origin` first, then the
 * `upstream` it opens pull requests against.
 */
export async function repositories(root, remotes, timeoutMs) {
  const cached = remoteCache.get(root);
  if (cached) return cached;

  const found = [];
  const seen = new Set();
  for (const remote of remotes) {
    const result = await run(["git", "-C", root, "remote", "get-url", remote], { timeoutMs });
    if (!result.ok) continue;
    const parsed = parseRemoteUrl(result.stdout);
    if (!parsed || seen.has(parsed.repoArg)) continue;
    seen.add(parsed.repoArg);
    found.push(parsed);
  }
  remoteCache.set(root, found);
  return found;
}
