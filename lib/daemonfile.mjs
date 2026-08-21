// The poller is a singleton per machine, recorded as a pid file in
// HERDR_PLUGIN_STATE_DIR. Herdr runs startup hooks again after a live handoff,
// so "start" has to be idempotent rather than assume it runs once.

import fs from "node:fs";
import path from "node:path";

import { stateDir } from "./config.mjs";

export function pidPath() {
  return path.join(stateDir(), "poller.pid");
}

export function logPath() {
  return path.join(stateDir(), "poller.log");
}

export function ensureStateDir() {
  fs.mkdirSync(stateDir(), { recursive: true });
}

/** The pid of a live poller, or null. */
export function livePid() {
  let pid;
  try {
    pid = Number.parseInt(fs.readFileSync(pidPath(), "utf8").trim(), 10);
  } catch {
    return null;
  }
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    // Signal 0 tests for existence and permission without delivering anything.
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

export function writePid(pid) {
  fs.writeFileSync(pidPath(), `${pid}\n`, "utf8");
}

export function clearPid() {
  try {
    fs.unlinkSync(pidPath());
  } catch {
    // Already gone; nothing to reconcile.
  }
}
