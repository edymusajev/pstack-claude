# Checkpoints and writer handoff

Use these gates for Feature work in this port. Keep the checkpoint in the checkout's Git directory, outside the diff. It persists across compaction and remains local. A branch name is not ownership.

## Checkpoint

Before implementation, run `node ../scripts/checkpoint.mjs init <checkout>` using the script's installed absolute path. The command prints the JSON file to maintain. Do not replace an existing checkpoint to clear outstanding work.

- Fill all four `throughput` dimensions. Update them at phase boundaries.
- Keep each required step `pending` until its evidence exists. A `passed` step names a transcript location, artifact, or command and result in `evidence`. Only `architect` accepts `skipped`, with a reason, as the Feature playbook permits.
- Define `verification` before delegation. Each row names a surface, operation or failure case, status, and evidence. Include adapter error handling and persistence after reload where relevant. `pending` and failed checks block the PR gate. Only an explicit user waiver permits `user-waived`; cite the user's instruction and disclose the gap in the PR.
- Add each disputed correctness or safety finding to `disagreements`. Resolve it as `fixed`, `interrogated`, or `user-waived`, with evidence. The orchestrator disagreeing with a reviewer is not a resolution.
- Set `phase` to the current unit. Stage the intended unit, then review the actual diff and evidence before running `node ../scripts/checkpoint.mjs stamp <checkout>`. Stamping records HEAD, staged and unstaged diffs, and untracked file contents; it does not run or certify tests. An edit, staging change, or commit invalidates that stamp.

Before each commit, run `node ../scripts/checkpoint.mjs check <checkout> commit`. It requires current cleanup and writing evidence, a populated throughput checkpoint, and no unresolved disagreements. Before PR creation, run the same command with `pr`. That also requires every required step and verification row to be resolved. Audit every safety claim against the implementation and recorded limitations before passing `claims-audit`. Small ordered commits do not substitute for checking each unit before advancing.

Claude Code's PreToolUse hook checks these gates for literal `git commit` and `gh pr create` / `origin pr create` commands when a checkpoint exists. Run these commands alone, after staging and auditing; shell chains or expansions could change the tree after the hook checks it and are rejected. Use a message/body file for multiline prose. SessionStart points back to the checkpoint after resume or compaction. Read it then; do not reconstruct completion from the conversation summary. Other runtimes must run the commands explicitly.

## Writer ownership

Launch `codex-run.sh --write --cwd <exclusive-checkout>` from outside the target checkout. Workspace selection still applies; run the wrapper on the Coder host when using Coder. Read-only runners are unchanged.

The wrapper atomically leases the target Git directory before starting a companion job. A second writer for that checkout fails. The wrapper always uses a tracked companion background job; without `--background` it waits and returns the result. Both modes retain the lease for handoff. The job ID and pinned companion path live in `pstack-writer/owner.json` inside that checkout's Git directory.

From outside the leased checkout, run `node ../scripts/writer-lease.mjs status <checkout>` to inspect ownership. Run `node ../scripts/writer-lease.mjs release <checkout>` only after the delegate and its background children have finished. Release queries that exact companion job and requires a completed or failed result, a completion timestamp, and a cleared worker PID. A cancellation notification, unknown status, or failed launch does not release ownership. After release, inspect `git status` and the diff before editing, testing, or committing.

Claude Code's hook rejects native file edits and shell commands whose cwd or literal paths target a leased checkout, including sibling worktrees and symlink aliases. Shell reads there are deliberately blocked too; use Read/Grep while waiting. The exact standalone status/release commands are allowed so a handoff cannot deadlock itself.

For a launch without a recorded job ID, inspect the companion's job list and processes. If the launched job is found, repair `owner.json` with that exact job ID and use normal release. If no job was launched, or a cancelled worker cannot report completion, verify the writer and all its children have stopped before manually removing that checkout's `pstack-writer` directory. There is no automatic age-based expiry or force-release flag.

## Enforcement boundary

This is a coordination guard, not a sandbox. It covers writers launched through this wrapper and Claude Code's named hooks on the same host. Claude Agent writers still require their own exclusive checkout and explicit stop/handoff; the Codex companion does not inherit Claude hooks. Shell variables, opaque scripts, other shells/tools, detached children, and remote commands cannot be fully attributed by a local hook. Use the same ownership protocol on the target host and never claim those paths are mechanically protected. The checkpoint checks recorded evidence and freshness, not whether the evidence proves the claim or whether the matrix is complete.

The hook JSON format follows the [Claude Code hooks reference](https://code.claude.com/docs/en/hooks).
