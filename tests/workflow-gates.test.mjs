import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkout, fingerprint, readJSON, writeJSON } from "../plugins/pstack/skills/poteto-mode/scripts/workflow-state.mjs";
import { initialize, check } from "../plugins/pstack/skills/poteto-mode/scripts/checkpoint.mjs";
import { claim, release } from "../plugins/pstack/skills/poteto-mode/scripts/writer-lease.mjs";
import { guard } from "../plugins/pstack/skills/poteto-mode/scripts/workflow-hook.mjs";

const scripts = fileURLToPath(new URL("../plugins/pstack/skills/poteto-mode/scripts/", import.meta.url));
const temporary = [];
afterEach(() => { for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pstack-gates-")));
  temporary.push(base);
  const root = path.join(base, "parent");
  const writer = path.join(base, "writer space");
  fs.mkdirSync(root);
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: "pipe" });
  git("init", "-q"); git("config", "user.email", "test@example.com"); git("config", "user.name", "Test");
  fs.writeFileSync(path.join(root, "file.txt"), "before\n");
  git("add", "."); git("commit", "-qm", "baseline");
  git("worktree", "add", "-qb", "writer", writer);
  const status = path.join(base, "status.json");
  writeJSON(status, { job: { id: "job-1", status: "running", pid: 123, completedAt: null } });
  const companion = path.join(base, "companion.mjs");
  fs.writeFileSync(companion, `import fs from 'node:fs';
const args = process.argv.slice(2);
if(args[0] === 'task') console.log(JSON.stringify({jobId:'job-1',status:'queued'}));
else if(args[0] === 'status') console.log(fs.readFileSync(${JSON.stringify(status)},'utf8'));
else if(args[0] === 'result') console.log('finished fixture task');
else process.exit(1);
`);
  return { root, writer, base, companion, status, git };
}

function filled(root) {
  const file = initialize(root);
  const state = readJSON(file);
  state.throughput = { blocking: "schema first", independent: "none", shared: "exclusive checkout", decomposition: "one unit" };
  state.steps = state.steps.map((step) => ({ ...step, status: "passed", evidence: "fixture result" }));
  state.verification = [{ surface: "invoice", operation: "duplicate and reload", status: "passed", evidence: "fixture browser transcript" }];
  state.fingerprint = fingerprint(root);
  writeJSON(file, state);
  return { file, state };
}

function running(f) {
  const lease = claim(f.writer, f.companion);
  lease.record.jobId = "job-1";
  writeJSON(`${lease.tree.lease}/owner.json`, lease.record);
  return lease;
}

test("a running delegate blocks the original parent write/test/commit sequence", () => {
  const f = fixture(); running(f);
  for (const command of [`cd '${f.writer}' && git commit -am change`, `git -C '${f.writer}' commit -am change`, `cd '${f.writer}' && bun test`, `cat '${f.writer}/file.txt'`]) {
    expect(() => guard({ cwd: f.root, tool_name: "Bash", tool_input: { command } })).toThrow("Writer owns");
  }
  for (const tool_name of ["Write", "Edit", "MultiEdit"]) {
    expect(() => guard({ cwd: f.root, tool_name, tool_input: { file_path: path.join(f.writer, "file.txt") } })).toThrow("Writer owns");
  }
  expect(() => guard({ cwd: f.root, tool_name: "Bash", tool_input: { command: "bun test" } })).not.toThrow();
  expect(() => guard({ cwd: f.writer, tool_name: "Read", tool_input: { file_path: "file.txt" } })).not.toThrow();
});

test("lease keys are checkout-specific and symlink aliases cannot evade ownership", () => {
  const f = fixture(); running(f);
  const alias = path.join(f.base, "alias"); fs.symlinkSync(f.writer, alias);
  expect(() => claim(alias, f.companion)).toThrow("already owns");
  expect(() => claim(f.root, f.companion)).not.toThrow();
  expect(() => guard({ cwd: f.base, tool_name: "Write", tool_input: { file_path: `${alias}/new.txt` } })).toThrow("Writer owns");
});

test("handoff requires the exact job's terminal record; unknown, cancelled, active and unavailable status retain the lease", () => {
  const f = fixture(); const lease = running(f);
  for (const job of [
    { id: "job-1", status: "running", pid: 123 },
    { id: "job-1", status: "cancelled", pid: null, completedAt: "now" },
    { id: "job-1", status: "completed", pid: 123, completedAt: "now" },
    { id: "other", status: "completed", pid: null, completedAt: "now" },
  ]) {
    writeJSON(f.status, { job });
    expect(() => release(f.writer)).toThrow();
    expect(fs.existsSync(lease.tree.lease)).toBe(true);
  }
  fs.writeFileSync(f.status, "invalid json");
  expect(() => release(f.writer)).toThrow();
  writeJSON(f.status, { job: { id: "job-1", status: "completed", pid: null, completedAt: "2026-09-08T00:00:00Z" } });
  expect(release(f.writer).released).toBe(f.writer);
  expect(() => guard({ cwd: f.writer, tool_name: "Bash", tool_input: { command: "bun test" } })).not.toThrow();
});

test("standalone lease inspection and release remain reachable but cannot smuggle a second command", () => {
  const f = fixture(); running(f);
  const command = `node '${scripts}writer-lease.mjs' status '${f.writer}'`;
  expect(() => guard({ cwd: f.writer, tool_name: "Bash", tool_input: { command } })).not.toThrow();
  expect(() => guard({ cwd: f.writer, tool_name: "Bash", tool_input: { command: `${command}; git commit -am bad` } })).toThrow("Writer owns");
  expect(() => guard({ cwd: f.writer, tool_name: "Bash", tool_input: { command: `node '${scripts}writer-lease.mjs' status "$(touch injected)"` } })).toThrow("Writer owns");
});

test("the actual writer wrapper rejects sharing, launches with a lease, and refuses a second launch", () => {
  const f = fixture();
  const run = (cwd, target) => spawnSync("bash", [path.join(scripts, "codex-run.sh"), "--model", "fixture-model", "--write", "--background", "--cwd", target, "implement"], { cwd, encoding: "utf8", env: { ...process.env, PSTACK_CODEX_COMPANION: f.companion } });
  expect(run(f.writer, f.writer).status).toBe(1);
  const launched = run(f.root, f.writer);
  expect(launched.status).toBe(0);
  expect(launched.stdout).toContain("job-1");
  expect(readJSON(`${checkout(f.writer).lease}/owner.json`).jobId).toBe("job-1");
  expect(run(f.root, f.writer).status).toBe(1);
});

test("ambiguous launch failure keeps the checkout protected", () => {
  const f = fixture();
  fs.writeFileSync(f.companion, "console.log('not JSON');");
  const result = spawnSync("bash", [path.join(scripts, "codex-run.sh"), "--model", "fixture-model", "--write", "--background", "--cwd", f.writer, "implement"], { cwd: f.root, encoding: "utf8", env: { ...process.env, PSTACK_CODEX_COMPANION: f.companion } });
  expect(result.status).toBe(1);
  expect(fs.existsSync(checkout(f.writer).lease)).toBe(true);
  expect(() => release(f.writer)).toThrow("Launch is incomplete");
});

test("read-only runners keep the existing same-checkout behavior without a lease", () => {
  const f = fixture();
  const result = spawnSync("bash", [path.join(scripts, "codex-run.sh"), "--model", "fixture-model", "--cwd", f.root, "inspect"], { cwd: f.root, encoding: "utf8", env: { ...process.env, PSTACK_CODEX_COMPANION: f.companion } });
  expect(result.status).toBe(0);
  expect(fs.existsSync(checkout(f.root).lease)).toBe(false);
});

test("checkpoint cannot pass with pending steps, missing matrix coverage, or an unresolved disagreement", () => {
  const f = fixture(); const { file, state } = filled(f.root);
  expect(check(f.root, "pr")).toContain("passed");
  state.steps.find((step) => step.id === "no-comments").status = "pending";
  writeJSON(file, state); expect(() => check(f.root, "pr")).toThrow("no-comments");
  state.steps.find((step) => step.id === "no-comments").status = "passed";
  state.verification[0].status = "pending";
  writeJSON(file, state); expect(() => check(f.root, "pr")).toThrow("unverified matrix");
  state.verification[0].status = "passed";
  state.disagreements = [{ finding: "duplicate replay safety", status: "overruled", evidence: "scope creep" }];
  writeJSON(file, state); expect(() => check(f.root, "commit")).toThrow("unresolved disagreement");
  state.disagreements[0].status = "interrogated";
  writeJSON(file, state); expect(check(f.root, "pr")).toContain("passed");
  expect(() => initialize(f.root)).toThrow("already exists");
});

test("edits, untracked content changes and commits invalidate the evidence stamp", () => {
  const f = fixture(); const { file, state } = filled(f.root);
  fs.writeFileSync(path.join(f.root, "new.txt"), "first");
  expect(() => check(f.root, "pr")).toThrow("stale");
  state.fingerprint = fingerprint(f.root); writeJSON(file, state);
  fs.writeFileSync(path.join(f.root, "new.txt"), "second");
  expect(() => check(f.root, "pr")).toThrow("stale");
  state.fingerprint = fingerprint(f.root); writeJSON(file, state);
  f.git("add", "."); f.git("commit", "-qm", "unit");
  expect(() => check(f.root, "commit")).toThrow("stale");
});

test("staged content cannot hide behind a restored working tree and commits cannot follow unchecked shell mutations", () => {
  const f = fixture(); const { file, state } = filled(f.root);
  fs.writeFileSync(path.join(f.root, "file.txt"), "staged change\n");
  f.git("add", "file.txt");
  fs.writeFileSync(path.join(f.root, "file.txt"), "before\n");
  expect(() => check(f.root, "commit")).toThrow("stale");
  state.fingerprint = fingerprint(f.root); writeJSON(file, state);
  expect(() => guard({ cwd: f.root, tool_name: "Bash", tool_input: { command: "git commit -m unit" } })).not.toThrow();
  expect(() => guard({ cwd: f.root, tool_name: "Bash", tool_input: { command: "git add . && git commit -m unit" } })).toThrow("command alone");
});

test("foreground writer waits for its tracked result and keeps the lease until handoff", () => {
  const f = fixture();
  writeJSON(f.status, { job: { id: "job-1", status: "completed", pid: null, completedAt: "now" } });
  const result = spawnSync("bash", [path.join(scripts, "codex-run.sh"), "--model", "fixture-model", "--write", "--cwd", f.writer, "implement"], { cwd: f.root, encoding: "utf8", env: { ...process.env, PSTACK_CODEX_COMPANION: f.companion } });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("finished fixture task");
  expect(fs.existsSync(checkout(f.writer).lease)).toBe(true);
  expect(release(f.writer).status).toBe("completed");
});

test("Claude hook emits a deny for incomplete PR creation and a resume pointer after compaction", () => {
  const f = fixture(); const file = initialize(f.root);
  const invoke = (input) => spawnSync("node", [path.join(scripts, "workflow-hook.mjs")], { input: JSON.stringify(input), encoding: "utf8" });
  const denied = invoke({ hook_event_name: "PreToolUse", cwd: f.root, tool_name: "Bash", tool_input: { command: "gh pr create --title feature" } });
  expect(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
  const resumed = invoke({ hook_event_name: "SessionStart", source: "compact", cwd: f.root });
  expect(resumed.stdout).toContain(file);
  expect(resumed.stdout).toContain("disagreements");
});
