#!/usr/bin/env node
// The poller. Sweeps on a timer until the Herdr server it reports to is gone.
//
// Pull request state changes on GitHub, not in Herdr, so no Herdr event can
// announce a merge. Polling is the only thing that can keep the sidebar honest,
// and the TTL on each reported token is what keeps it honest if this process
// dies.

import { loadConfig } from "../lib/config.mjs";
import { clearPid, ensureStateDir, writePid } from "../lib/daemonfile.mjs";
import { sweep } from "../lib/sweep.mjs";

const MAX_CONSECUTIVE_FAILURES = 3;

function log(message) {
  process.stdout.write(`${new Date().toISOString()} ${message}\n`);
}

async function main() {
  const config = loadConfig();
  ensureStateDir();
  writePid(process.pid);

  let stopping = false;
  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    log(`stopping on ${signal}; tokens expire in ${config.ttl_ms}ms`);
    clearPid();
    process.exit(0);
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));

  log(`started pid=${process.pid} interval=${config.interval_seconds}s ttl=${config.ttl_ms}ms`);

  const previous = new Map();
  let failures = 0;
  for (;;) {
    const result = await sweep({ config, previous });
    if (result.ok) {
      failures = 0;
      log(
        `sweep spaces=${result.spaces} repos=${result.repos} shown=${result.shown} reported=${result.reported}` +
          (result.failures.length > 0 ? ` errors=${result.failures.join("; ")}` : ""),
      );
    } else {
      failures += 1;
      log(`sweep failed (${failures}/${MAX_CONSECUTIVE_FAILURES}): ${result.reason}`);
      // The server went away. Exiting is correct: Herdr's startup hook runs
      // again for the next server, and an orphan poller talking to a dead socket
      // helps nobody.
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        log("giving up; no reachable Herdr server");
        clearPid();
        process.exit(0);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, config.interval_seconds * 1000));
  }
}

main().catch((error) => {
  log(`fatal: ${error?.stack ?? error}`);
  clearPid();
  process.exit(1);
});
