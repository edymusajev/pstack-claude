#!/usr/bin/env bash
# Run one Codex model as a pstack runner through the codex plugin's companion
# runtime (openai-codex/codex for Claude Code).
#
#   codex-run.sh --model <slug> [--effort <level>] (--prompt-file <file> | <prompt...>)
#                [--write] [--cwd <dir>] [--background]
#
# Prints Codex's final message on stdout. Read-only unless --write is passed.
# Set PSTACK_CODEX_COMPANION to a codex-companion.mjs path to pin a plugin
# version; otherwise the newest installed version under the Claude Code plugin
# cache is used. See references/runners.md for how pstack skills call this.
set -euo pipefail

usage() {
  sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

find_companion() {
  if [[ -n "${PSTACK_CODEX_COMPANION:-}" ]]; then
    printf '%s\n' "$PSTACK_CODEX_COMPANION"
    return 0
  fi
  local cache="${CLAUDE_PLUGINS_CACHE:-$HOME/.claude/plugins/cache}/openai-codex/codex"
  [[ -d "$cache" ]] || return 1
  local version
  version="$(find "$cache" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)"
  [[ -n "$version" && -f "$cache/$version/scripts/codex-companion.mjs" ]] || return 1
  printf '%s\n' "$cache/$version/scripts/codex-companion.mjs"
}

model=""
effort=""
prompt_file=""
cwd=""
write=0
background=0
prompt=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --model|-m) [[ $# -ge 2 ]] || usage; model="$2"; shift 2 ;;
    --effort) [[ $# -ge 2 ]] || usage; effort="$2"; shift 2 ;;
    --prompt-file) [[ $# -ge 2 ]] || usage; prompt_file="$2"; shift 2 ;;
    --cwd) [[ $# -ge 2 ]] || usage; cwd="$2"; shift 2 ;;
    --write) write=1; shift ;;
    --background) background=1; shift ;;
    -h|--help) usage ;;
    --) shift; prompt+=("$@"); break ;;
    -*) printf 'codex-run.sh: unknown flag %s\n' "$1" >&2; usage ;;
    *) prompt+=("$1"); shift ;;
  esac
done

[[ -n "$model" ]] || { printf 'codex-run.sh: --model is required\n' >&2; usage; }
if [[ -z "$prompt_file" && ${#prompt[@]} -eq 0 ]]; then
  printf 'codex-run.sh: pass --prompt-file <file> or a prompt\n' >&2
  usage
fi
if [[ -n "$prompt_file" && ! -f "$prompt_file" ]]; then
  printf 'codex-run.sh: prompt file not found: %s\n' "$prompt_file" >&2
  exit 2
fi

if ! companion="$(find_companion)"; then
  cat >&2 <<'MSG'
codex-run.sh: the codex plugin for Claude Code is not installed.
Install it with `/plugin install codex@openai-codex`, then run `/codex:setup`.
Or set PSTACK_CODEX_COMPANION to the path of its scripts/codex-companion.mjs.
MSG
  exit 3
fi
if [[ ! -f "$companion" ]]; then
  printf 'codex-run.sh: PSTACK_CODEX_COMPANION does not exist: %s\n' "$companion" >&2
  exit 3
fi

args=(task --fresh --model "$model")
[[ -n "$effort" ]] && args+=(--effort "$effort")
[[ $write -eq 1 ]] && args+=(--write)
[[ $background -eq 1 ]] && args+=(--background)
if [[ -n "$cwd" ]]; then
  cwd="$(cd "$cwd" && pwd -P)"
  args+=(--cwd "$cwd")
fi
if [[ -n "$prompt_file" ]]; then
  args+=(--prompt-file "$(cd "$(dirname "$prompt_file")" && pwd -P)/$(basename "$prompt_file")")
else
  args+=("${prompt[*]}")
fi

exec node "$companion" "${args[@]}"
