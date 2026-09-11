#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { checkout, readJSON, writeJSON } from "./workflow-state.mjs";

export function claim(cwd, companion) {
  const tree = checkout(cwd);
  try { fs.mkdirSync(tree.lease, { mode: 0o700 }); }
  catch (error) {
    if (error.code === "EEXIST") throw new Error(`Writer already owns ${tree.root}. Inspect writer-lease.mjs status and complete the handoff first.`);
    throw error;
  }
  const record = { root: tree.root, companion, launcherPid: process.pid, jobId: null, startedAt: new Date().toISOString() };
  writeJSON(`${tree.lease}/owner.json`, record);
  return { tree, record };
}

export function snapshot(record) {
  if (!record.jobId) throw new Error("Launch is incomplete. Inspect companion jobs and processes; do not infer that the writer stopped.");
  const result = spawnSync(process.execPath, [record.companion, "status", record.jobId, "--cwd", record.root, "--json"], { encoding: "utf8", timeout: 15000 });
  if (result.error || result.status !== 0) throw new Error("Cannot confirm writer status; lease retained.");
  const value = JSON.parse(result.stdout);
  if (value.job?.id !== record.jobId) throw new Error("Companion returned another job; lease retained.");
  return value.job;
}

export function release(cwd) {
  const tree = checkout(cwd);
  const lock = `${tree.lease}/handoff`;
  try { fs.mkdirSync(lock); }
  catch (error) {
    if (error.code === "EEXIST") throw new Error("A handoff is already in progress; inspect it before retrying.");
    throw error;
  }
  try { return releaseOwned(tree); }
  catch (error) {
    fs.rmSync(lock, { recursive: true, force: true });
    throw error;
  }
}

function releaseOwned(tree) {
  const record = readJSON(`${tree.lease}/owner.json`);
  const job = snapshot(record);
  if (!["completed", "failed"].includes(job.status) || job.pid !== null || !job.completedAt) {
    throw new Error(`Writer has no confirmed terminal result (${job.status}); lease retained. Cancellation alone is not a handoff.`);
  }
  fs.rmSync(tree.lease, { recursive: true });
  return { released: tree.root, jobId: record.jobId, status: job.status };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [action, cwd] = process.argv.slice(2);
    if (!cwd || !["status", "release"].includes(action)) throw new Error("Usage: node writer-lease.mjs status|release <checkout>");
    const record = action === "release" ? release(cwd) : readJSON(`${checkout(cwd).lease}/owner.json`);
    console.log(JSON.stringify(record, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
