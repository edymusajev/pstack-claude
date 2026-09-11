#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkout, writeJSON } from "./workflow-state.mjs";
import { claim, snapshot } from "./writer-lease.mjs";

try {
  const [companion, ...args] = process.argv.slice(2);
  const at = args.indexOf("--cwd");
  if (at < 0) throw new Error("A writer requires --cwd pointing to an exclusive checkout.");
  const target = checkout(args[at + 1]);
  let caller;
  try { caller = checkout(process.cwd()); } catch { /* An orchestrator may run outside a repository. */ }
  if (caller?.root === target.root) throw new Error("Do not launch a writer in the orchestrator's checkout. Pass a separate --cwd and launch from outside it.");
  const { tree, record } = claim(target.root, companion);
  const background = args.includes("--background");
  const launch = spawnSync(process.execPath, [companion, ...args.filter((arg) => arg !== "--background"), "--background", "--json"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (launch.error || launch.status !== 0) throw new Error(`Writer launch failed; lease retained for inspection. ${launch.stderr || launch.error?.message || ""}`);
  const payload = JSON.parse(launch.stdout);
  if (typeof payload.jobId !== "string" || !payload.jobId) throw new Error("Missing companion job ID; lease retained for inspection.");
  record.jobId = payload.jobId;
  writeJSON(`${tree.lease}/owner.json`, record);
  console.log(`Codex Task started in the background as ${record.jobId}. Checkout leased: ${tree.root}`);
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  console.log(`After the worker finishes, run: node ${quote(fileURLToPath(new URL("writer-lease.mjs", import.meta.url)))} release ${quote(tree.root)}`);
  if (!background) {
    let job;
    do {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      job = snapshot(record);
    } while (["queued", "running"].includes(job.status));
    const result = spawnSync(process.execPath, [companion, "result", record.jobId, "--cwd", tree.root], { stdio: "inherit" });
    process.exitCode = job.status === "completed" && result.status === 0 ? 0 : 1;
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
