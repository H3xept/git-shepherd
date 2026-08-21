// Process helpers. Every external command in this plugin goes through `run`, so
// there is one place that owns timeouts, argv-only invocation (never a shell),
// and the "a failed command is data, not an exception" contract.

import { spawn } from "node:child_process";

/**
 * Run an argv command and capture its output.
 *
 * Never throws for a non-zero exit, a spawn error, or a timeout: those are
 * reported in the resolved value. A caller that cannot proceed decides that
 * itself.
 *
 * @returns {Promise<{ok: boolean, code: number|null, stdout: string, stderr: string, error: string|null}>}
 */
export function run(argv, { cwd, timeoutMs = 15000, env } = {}) {
  const [command, ...args] = argv;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env: env ? { ...process.env, ...env } : process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      resolve({ ok: false, code: null, stdout: "", stderr: "", error: String(error?.message ?? error) });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ ok: false, code: null, stdout, stderr, error: `timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      finish({ ok: false, code: null, stdout, stderr, error: String(error?.message ?? error) });
    });
    child.on("close", (code) => {
      finish({ ok: code === 0, code, stdout, stderr, error: null });
    });
  });
}

/**
 * Resolve `tasks` with at most `limit` running at once.
 *
 * The sweep fans out one git call per Space and one `gh` call per repository.
 * Unbounded parallelism there would spawn a process per Space at the same time,
 * which is the one thing a background poller must not do.
 */
export async function pooled(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const size = Math.max(1, Math.min(limit, items.length));
  const runners = Array.from({ length: size }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}
