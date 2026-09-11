---
name: setup-pstack
description: Configure which models pstack uses per role, across Claude and Codex. Detects the Claude and Codex models you can run, writes a per-role override sheet the user includes from CLAUDE.md, and writes a personal runner subagent for any Claude entry the plugin does not ship. Use for /setup-pstack, "configure pstack models", or changing pstack's model choices.
---

# Setup pstack

On Codex, read the [platform mapping](../poteto-mode/references/codex-tools.md), including its per-skill notes, before following this skill.

Write `~/.claude/pstack-models.md`, a per-role override sheet you include from your global `CLAUDE.md`. Each pstack skill names a default entry per role inline; the override sheet is the layer that adapts those defaults to the models you actually have access to.

An entry is `<slug>` or `<slug>@<effort>`. The slug is a Claude model or a Codex model from [Models](#models); the effort is one of the levels listed there, and an entry with no effort inherits the session's level. How an entry runs is in the [runner table](../poteto-mode/references/runners.md): a Claude entry is a plugin subagent carrying that model and effort, a Codex entry is a call through the codex plugin.

Claude Code has no auto-applied "rules" mechanism like Cursor's `.mdc`. Inclusion is explicit: the user adds a line to `~/.claude/CLAUDE.md` (or their project `CLAUDE.md`) such as:

```text
@~/.claude/pstack-models.md
```

so the file is loaded as context for every session.

## Steps

### 1. Detect available models

Two sources, one per vendor:

- **Claude.** The Claude models in [Models](#models) are the ones Claude Code can run as a subagent; confirm with the user which of them their plan includes. Never write a real slug the user has not confirmed.
- **Codex.** Read `~/.codex/models_cache.json` when it exists and list its model slugs; that file is what the codex CLI last fetched for this login. Keep only slugs that also appear in [Models](#models), and show any it lists that pstack does not know so the user can ask for them to be added. If the file is absent, the codex CLI has not been used on this machine: run `/codex:setup`, or leave every Codex entry out and tell the user the panels will run Claude-only until Codex is set up.

The aliases `inherit-parent` and `auto` are always valid even though they are not detected slugs; both mean the role runs on the parent session's model and effort.

### 2. Load current state

The default role-to-entry mapping is the sheet shape shown in step 5 below. If `~/.claude/pstack-models.md` already exists, read it and treat its values as the current choices. Otherwise start from those defaults.

### 3. Map and confirm

Show every role with its current entry, marking any slug not in the detected set as needing a choice. Ask whether to accept as-is or change specific roles, offering the detected models plus `inherit-parent` and `auto` as the options, and the effort suffix as a second choice per entry. Prefer `AskUserQuestion` over free text. For panel roles (arena runners, architect runners, interrogate reviewers) the value is a list, and one runner runs per entry, alias entries included, so the list length sets the count; keep at least one Claude and one Codex entry in each panel when the user has both, because the adversarial signal comes from vendor diversity. `arena cross-judge pool` is also a list, but Arena selects one value from it whose vendor differs from the parent's when possible. `swarm workers` is the default entry for every worker unless a race or comparison assigns another per arm.

Offer either vendor for every role. For evidence-dependent roles (`why` investigators and synthesizer, and reflect's judgment lenses), check the selected runner's own tool access as described in the runner table. Codex uses its own MCP configuration; Claude's connections are not forwarded. Report missing access separately from model availability.

### 4. Validate

Every slug written must be in the detected set, every effort suffix must be one of the listed levels; `inherit-parent` and `auto` always pass. If a chosen value fails, stop and ask again.

### 5. Write the override sheet

Write `~/.claude/pstack-models.md` with the shape below. Overwrite the whole file so re-runs stay idempotent.

```markdown
# pstack model configuration

Per-role model overrides for pstack skills. Each pstack SKILL.md names its defaults in a Models section; the values here override those defaults. Delete a line to fall back to the skill default. An entry is `<slug>` or `<slug>@<effort>`: a Claude model runs as the matching `pstack:` runner subagent, a Codex model runs through the codex plugin, and a missing effort inherits the session's level. A value of `inherit-parent` or `auto` runs that role on the parent session's model and effort (dispatch `general-purpose`, or `pstack:poteto-agent` for a code-writing brief, with no `model`); an alias entry in a panel list still counts toward that panel's fan-out.

feature, refactoring: gpt-5.6-sol@medium
bug-fix: gpt-6-astra@xhigh
perf-issue: gpt-6-astra@xhigh
hillclimb: gpt-6-astra@xhigh
judgment and prose: claude-fable-5-1@high
strongest judgment: claude-fable-5-1@xhigh
how explorer: gpt-5.6-sol@low
how explainer: claude-fable-5-1@high
why investigators: gpt-6-astra@low
why synthesizer: claude-fable-5-1@high
reflect tooling: gpt-5.6-sol@high
reflect judgment, divergent, synthesizer: claude-fable-5-1@high
arena runners: claude-fable-5-1@xhigh, gpt-6-astra@xhigh
arena cross-judge pool: claude-fable-5-1@xhigh, gpt-6-astra@xhigh
swarm workers: gpt-5.6-sol@low
architect runners: claude-fable-5-1@xhigh, gpt-6-astra@xhigh
interrogate reviewers: claude-fable-5-1@xhigh, gpt-6-astra@xhigh
```

### 6. Write personal runners for new Claude entries

Every Claude entry in the plugin defaults ships as a plugin subagent. A Claude entry the user chose that is not in the defaults has none, so write one to `~/.claude/agents/<name>.md`, where `<name>` is the slug without its `claude-` prefix plus `-<effort>` when an effort is set (an `@xhigh` entry on the Opus 5 slug becomes `opus-5-xhigh`):

```markdown
---
name: <name>
description: pstack runner, <label> at <effort> effort. Dispatched by pstack skills for roles configured as `<entry>`; not a general-purpose helper.
model: <slug>
effort: <effort>
---

# pstack runner: <label> at <effort> effort

You are a pstack runner: one fixed model and effort level that pstack skills dispatch for a configured role. Follow the brief you were given exactly and return what it asks for, nothing more.

- A brief that writes code: read the `poteto-mode` skill's `SKILL.md` in full first, including its inline Principles index, and work in its style. Stay inside the worktree and paths the brief names.
- A brief that reviews, judges, explores, or investigates: the brief's template governs. Do not edit files unless the brief says to.
- Return file pointers and findings, not inlined dumps of what you read.
```

Omit the `effort` line for an entry with no suffix. A personal runner is dispatched as `subagent_type: "<name>"` with no plugin prefix, and it appears in the next session, so tell the user that. Codex entries need no file; the runner table's script takes the slug and effort as flags.

### 7. Wire it in

If `~/.claude/CLAUDE.md` does not already include `~/.claude/pstack-models.md`, append the `@~/.claude/pstack-models.md` line so it loads on every session. If the user prefers project scope, add the include to the project's `CLAUDE.md` instead.

### 8. Confirm

Tell the user where the override was written and how it loads (via the `@` include in CLAUDE.md), which personal runners were written, and that a Codex entry needs the codex plugin (`/plugin install codex@openai-codex`) and a logged-in codex CLI (`/codex:setup`). Re-running this skill updates the override sheet.

### 9. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /create-verification-skill." On yes, invoke `/create-verification-skill` (resolves wherever pstack is installed: workspace, user, or plugin). On no, move on without pushing.

## Models

Stamped from `plugins/pstack/models.json` (edit there, rerun `tools/generate.mjs`).

- Claude models: Fable 5.1 (`claude-fable-5-1`), Fable 5 (`claude-fable-5`), Opus 5 (`claude-opus-5`), Opus 4.8 (`claude-opus-4-8`), Sonnet 5 (`claude-sonnet-5`), Sonnet 4.6 (`claude-sonnet-4-6`), Haiku 4.5 (`claude-haiku-4-5`)
- Codex models: GPT-6 Astra (`gpt-6-astra`), GPT-5.6 Sol (`gpt-5.6-sol`), GPT-5.6 Terra (`gpt-5.6-terra`), GPT-5.6 Luna (`gpt-5.6-luna`), GPT-5.5 (`gpt-5.5`), GPT-5.4 mini (`gpt-5.4-mini`), GPT-5.3 Codex Spark (`gpt-5.3-codex-spark`)
- Effort levels: `low`, `medium`, `high`, `xhigh`, `max`; omit the suffix to inherit the session's level
- Default panel: `claude-fable-5-1@xhigh`, `gpt-6-astra@xhigh`
- All roles support Claude or Codex entries. Evidence access must be checked in the selected runner; MCP connections are not shared between runtimes.
