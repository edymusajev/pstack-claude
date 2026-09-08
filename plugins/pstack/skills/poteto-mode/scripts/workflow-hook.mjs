#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonical, checkout, git, inside } from "./workflow-state.mjs";
import { check } from "./checkpoint.mjs";

// This lexer identifies literal paths. It does not execute or expand shell input.
export function words(command) {
  const tokens = command.match(/'(?:[^']*)'|"(?:\\.|[^"\\])*"|[^\s;&|]+|[;&|]+/g) || [];
  return tokens.map((token) => {
    if (token.startsWith("'") && token.endsWith("'")) return token.slice(1, -1);
    if (token.startsWith('"') && token.endsWith('"')) return token.slice(1, -1);
    return token;
  });
}

function treesFor(cwd, tokens) {
  const trees = new Map();
  for (let candidate of [cwd, ...tokens]) {
    if (!candidate || /[\n\r$`]/.test(candidate)) continue;
    if (candidate !== cwd && !candidate.includes("/") && candidate !== "." && candidate !== "..") continue;
    if (candidate.includes("=")) candidate = candidate.slice(candidate.indexOf("=") + 1);
    candidate = canonical(path.resolve(cwd, candidate));
    while (!fs.existsSync(candidate) && path.dirname(candidate) !== candidate) candidate = path.dirname(candidate);
    if (!fs.statSync(candidate).isDirectory()) candidate = path.dirname(candidate);
    try {
      const tree = checkout(candidate);
      trees.set(tree.root, tree);
      for (const line of git(tree.root, "worktree", "list", "--porcelain").split("\n")) {
        if (!line.startsWith("worktree ")) continue;
        const sibling = checkout(line.slice(9));
        trees.set(sibling.root, sibling);
      }
    } catch { /* Non-repository arguments are not checkouts. */ }
  }
  return [...trees.values()];
}

export function guard(input) {
  const cwd = canonical(input.cwd || process.cwd());
  const tool = input.tool_name;
  if (!["Bash", "Write", "Edit", "MultiEdit", "NotebookEdit"].includes(tool)) return;
  const body = input.tool_input || {};
  const tokens = tool === "Bash" ? words(body.command || "") : [];
  const files = [body.file_path, body.notebook_path, ...(body.edits || []).map((edit) => edit.file_path)].filter(Boolean);
  const trees = treesFor(cwd, [...tokens, ...files]);
  const control = fileURLToPath(new URL("writer-lease.mjs", import.meta.url));
  const leaseControl = !/[\n\r$`\\]/.test(body.command || "") && tokens.length === 4 && tokens[0] === "node" && canonical(path.resolve(cwd, tokens[1])) === control && ["status", "release"].includes(tokens[2]);
  if (tool === "Bash" && leaseControl) return;
  for (const tree of trees) {
    if (!fs.existsSync(tree.lease)) continue;
    const references = tool === "Bash" ? [cwd, ...tokens.map((token) => token.includes("=") ? token.slice(token.indexOf("=") + 1) : token)] : files;
    if (references.some((reference) => inside(canonical(path.resolve(cwd, reference)), tree.root))) {
      throw new Error(`Writer owns ${tree.root}. No edits, shell commands, commits, or suites there until writer-lease.mjs release confirms its terminal result. Use Read/Grep for inspection or work in another checkout.`);
    }
  }
  if (tool === "Bash") {
    const command = body.command || "";
    const stage = /\b(?:gh|origin)\s+pr\s+create\b/.test(command) ? "pr" : /\bgit\b[^;&|\n]*\bcommit\b/.test(command) ? "commit" : null;
    if (stage) {
      const referenced = trees.filter((tree) => inside(cwd, tree.root) || tokens.some((token) => inside(canonical(path.resolve(cwd, token)), tree.root)));
      for (const tree of referenced) if (fs.existsSync(tree.checkpoint)) {
        if (/[\n\r$`<>]/.test(command) || tokens.some((token) => /^[;&|]+$/.test(token))) throw new Error("Run the commit or PR command alone, without shell expansion or redirection, after staging and auditing. A compound command can change the tree after the checkpoint check.");
        check(tree.root, stage);
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const input = JSON.parse(fs.readFileSync(0, "utf8"));
    if (input.hook_event_name === "SessionStart") {
      let tree;
      try { tree = checkout(input.cwd || process.cwd()); } catch { /* No active repository. */ }
      if (tree && fs.existsSync(tree.checkpoint)) console.log(`Resume the Poteto checkpoint at ${tree.checkpoint}. Read it before continuing; pending verification and disagreements survive compaction. Re-audit after changes.`);
    } else guard(input);
  } catch (error) {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: error.message } }));
  }
}
