# pstack runners

pstack names models as entries. An entry reads `<slug>` or `<slug>@<effort>`: the slug is a Claude model (`claude-*`) or a Codex model (`gpt-*`) from the list `/setup-pstack` shows, the effort is `low`, `medium`, `high`, `xhigh`, or `max`, and an entry with no effort inherits the session's level. Every role in a skill's Models section, and every line of `~/.claude/pstack-models.md`, is a list of entries. This file says how one entry becomes one running subagent on Claude Code.

## Runner table

| Entry | Vendor | Runs as | Dispatch |
|---|---|---|---|
| `gpt-5.6-sol@xhigh` | codex | GPT-5.6 Sol, xhigh effort | `../scripts/codex-run.sh --model gpt-5.6-sol --effort xhigh` |
| `gpt-6-astra@xhigh` | codex | GPT-6 Astra, xhigh effort | `../scripts/codex-run.sh --model gpt-6-astra --effort xhigh` |
| `claude-fable-5-1@high` | claude | Fable 5.1, high effort | `subagent_type: "pstack:fable-5-1-high"` |
| `claude-fable-5-1@xhigh` | claude | Fable 5.1, xhigh effort | `subagent_type: "pstack:fable-5-1-xhigh"` |
| `gpt-6-astra@low` | codex | GPT-6 Astra, low effort | `../scripts/codex-run.sh --model gpt-6-astra --effort low` |
| `gpt-5.6-sol@high` | codex | GPT-5.6 Sol, high effort | `../scripts/codex-run.sh --model gpt-5.6-sol --effort high` |

## Claude entries

A Claude entry runs as a generated plugin subagent whose frontmatter carries the model ID and the effort. Dispatch it with the `Agent` tool: `subagent_type: "pstack:<name>"` from the table, `run_in_background: true`, and the brief as the prompt. Do not pass `model`. The Agent tool accepts only the four family aliases and no effort at all, which is why the runner exists. The runner reads `poteto-mode` before a code-writing brief and follows the brief's template for everything else, so the brief carries the role's prompt (the reviewer template, the explorer prompt, the scope of a code change), not style instructions.

A Claude entry the table lacks (one you wrote into the override sheet) has no plugin runner. `/setup-pstack` writes a personal one to `~/.claude/agents/<name>.md` with the same frontmatter shape. Until it exists, dispatch `general-purpose` with `model` set to the family alias (`fable`, `opus`, `sonnet`, `haiku`) and note in your output that the effort suffix was not applied.

`inherit-parent` and `auto` run on the parent session's model and effort: dispatch `general-purpose`, or `pstack:poteto-agent` for a code-writing brief, with no `model`.

## Codex entries

A Codex entry runs through the codex plugin's companion runtime, wrapped by `../scripts/codex-run.sh`. Write the brief to a file, then make one `Bash` call per runner with `run_in_background: true` so a panel fans out in parallel:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/poteto-mode/scripts/codex-run.sh" \
  --model <slug> --effort <effort> \
  --prompt-file /tmp/pstack-<slug>/reviewer-b.md
```

If `${CLAUDE_PLUGIN_ROOT}` is not expanded where you read this, the script is `scripts/codex-run.sh` beside this skill's `SKILL.md` in the installed plugin.

Flags: `--model` and `--effort` come from the entry. `--prompt-file` carries the brief; a short brief can be passed as positional text instead. The run is read-only unless `--write` is passed. Pass it only for a brief that must produce files, together with `--cwd <worktree>` so the writes land in that candidate's own tree. `--background` returns a job id instead of blocking; read it back with `/codex:result`. The script prints Codex's final message on stdout, which the `Bash` tool returns to you as the runner's result.

Tool access follows the runner. Codex uses the local Codex CLI's configuration and authentication, including its own MCP servers. It does not inherit Claude Code's MCP connections or the `verify` and `run` built-ins. Every role may use either vendor. For a brief requiring external evidence, inspect the selected runner's available tools and verify access with a read-only lookup before relying on that source; a configured server alone is not proof of authentication or access. Pass the same `--cwd` for discovery and the actual task so project configuration matches. Never infer Codex availability from Claude's tool list.

If a required source is available only to the parent, the parent can fetch it and pass a dated, cited evidence file to Codex. Mark that evidence as parent-supplied; the delegate must not claim to have queried or independently verified it. Otherwise use a runner with access for that source and report the substitution, or record the source as unavailable. Do not silently omit evidence categories. Read-only evidence gathering does not require `--write`; keep repository writes disabled. Supply the role's prompt and relevant skill file paths explicitly: Codex does not invoke Claude's Skill tool, but can read supplied instructions from disk.

Requirements. The codex plugin (`/plugin install codex@openai-codex`) and a logged-in codex CLI (`/codex:setup`). The script finds the newest installed plugin version; set `PSTACK_CODEX_COMPANION` to a `codex-companion.mjs` path to pin one. If the script reports that the plugin is missing, send that entry's brief to the nearest Claude entry in the same panel instead, note the substitution in the verdict, and do not block the skill on it.

## Panels

A panel role (`arena runners`, `architect runners`, `interrogate reviewers`, `arena cross-judge pool`) is a list. Spawn one runner per entry, all in one message, mixing `Agent` calls for Claude entries and `Bash` calls for Codex entries. Both accept `run_in_background: true`, and each returns through its task notification. The adversarial signal comes from vendor diversity, so keep at least one entry of each vendor when you shrink a panel.
