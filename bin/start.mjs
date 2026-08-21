#!/usr/bin/env node
// Startup hook and `start` action: make sure exactly one poller is running.
//
// Herdr documents startup hooks as one-shot initialization, not supervised
// daemons, so this exits immediately after detaching the poller instead of
// becoming the poller itself.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { clearPid, ensureStateDir, livePid, logPath } from "../lib/daemonfile.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

ensureStateDir();

const existing = livePid();
if (existing !== null) {
  process.stdout.write(`git-shepherd poller already running (pid ${existing})\n`);
  process.exit(0);
}
clearPid();

const log = fs.openSync(logPath(), "a");
const child = spawn(process.execPath, [path.join(here, "daemon.mjs")], {
  cwd: path.join(here, ".."),
  detached: true,
  stdio: ["ignore", log, log],
  windowsHide: true,
});
child.unref();
fs.closeSync(log);

process.stdout.write(`git-shepherd poller started (pid ${child.pid}), logging to ${logPath()}\n`);
