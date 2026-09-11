#!/usr/bin/env node
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { checkout, fingerprint, readJSON, writeJSON } from "./workflow-state.mjs";

const required = ["how", "architect", "design-review", "implementation-review", "no-comments", "deslop", "technical-writing", "unslop", "sequence", "claims-audit"];
const dimensions = ["blocking", "independent", "shared", "decomposition"];
const text = (value) => typeof value === "string" && value.trim().length > 0;

export function initialize(cwd) {
  const tree = checkout(cwd);
  if (fs.existsSync(tree.checkpoint)) throw new Error("Checkpoint already exists; update it rather than dropping unresolved work.");
  const state = {
    version: 1, phase: "design", fingerprint: "",
    throughput: Object.fromEntries(dimensions.map((name) => [name, ""])),
    steps: required.map((id) => ({ id, status: "pending", evidence: "" })),
    verification: [{ surface: "", operation: "", status: "pending", evidence: "" }],
    disagreements: [],
  };
  writeJSON(tree.checkpoint, state);
  return tree.checkpoint;
}

export function check(cwd, stage) {
  if (!["commit", "pr"].includes(stage)) throw new Error("Stage must be commit or pr.");
  const tree = checkout(cwd);
  if (fs.existsSync(tree.lease)) throw new Error("Writer still owns this checkout; complete the handoff first.");
  const state = readJSON(tree.checkpoint);
  const errors = [];
  if (state.version !== 1 || !text(state.phase)) errors.push("missing version or phase");
  if (state.fingerprint !== fingerprint(tree.root)) errors.push("checkpoint is stale; audit the current tree and run checkpoint.mjs stamp");
  for (const dimension of dimensions) if (!text(state.throughput?.[dimension])) errors.push(`throughput.${dimension} is empty`);
  const steps = Array.isArray(state.steps) ? state.steps : [];
  for (const id of stage === "commit" ? ["deslop", "technical-writing", "unslop"] : required) {
    const matches = steps.filter((step) => step.id === id);
    const step = matches[0];
    const allowedSkip = id === "architect" && step?.status === "skipped";
    if (matches.length !== 1 || (!allowedSkip && step?.status !== "passed") || !text(step?.evidence)) errors.push(`${id} needs evidence${id === "architect" ? " or a skip reason" : " and a pass"}`);
  }
  if (!Array.isArray(state.disagreements)) errors.push("disagreements must be an array");
  else for (const disagreement of state.disagreements) {
    if (!text(disagreement.finding) || !["fixed", "interrogated", "user-waived"].includes(disagreement.status) || !text(disagreement.evidence)) errors.push("unresolved disagreement; record the fix, interrogate result, or explicit user waiver");
  }
  if (stage === "pr") {
    if (!Array.isArray(state.verification) || state.verification.length === 0) errors.push("verification matrix is empty");
    else for (const row of state.verification) {
      if (!text(row.surface) || !text(row.operation) || !["passed", "user-waived"].includes(row.status) || !text(row.evidence)) errors.push(`unverified matrix row: ${row.surface || "missing surface"} / ${row.operation || "missing operation"}`);
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return `${stage} checkpoint passed. Evidence content still requires review.`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [action, cwd, stage] = process.argv.slice(2);
    if (!cwd) throw new Error("Usage: node checkpoint.mjs init|show|stamp|check <checkout> [commit|pr]");
    const tree = checkout(cwd);
    if (action === "init") console.log(initialize(cwd));
    else if (action === "show") console.log(JSON.stringify(readJSON(tree.checkpoint), null, 2));
    else if (action === "stamp") {
      const state = readJSON(tree.checkpoint);
      state.fingerprint = fingerprint(tree.root);
      writeJSON(tree.checkpoint, state);
      console.log(tree.checkpoint);
    } else if (action === "check") console.log(check(cwd, stage));
    else throw new Error("Unknown checkpoint action.");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
