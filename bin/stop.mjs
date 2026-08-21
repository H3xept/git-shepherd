#!/usr/bin/env node
// `stop` action: end the poller and take the icons down now rather than waiting
// for their TTL.

import { loadConfig } from "../lib/config.mjs";
import { clearPid, livePid } from "../lib/daemonfile.mjs";
import { clearAll } from "../lib/sweep.mjs";

const pid = livePid();
if (pid === null) {
  process.stdout.write("git-shepherd poller not running\n");
} else {
  try {
    process.kill(pid, "SIGTERM");
    process.stdout.write(`git-shepherd poller stopped (pid ${pid})\n`);
  } catch (error) {
    process.stdout.write(`could not signal pid ${pid}: ${error?.message ?? error}\n`);
  }
}
clearPid();

const result = await clearAll(loadConfig());
process.stdout.write(
  result.ok ? `cleared tokens on ${result.cleared} spaces\n` : `could not clear tokens: ${result.reason}\n`,
);
