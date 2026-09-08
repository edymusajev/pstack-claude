// Runners are how a model entry becomes a running subagent. A Claude entry is
// a generated plugin agent (Claude Code's Agent tool takes no full model ID
// and no effort, so the frontmatter carries both); a Codex entry is a call
// through scripts/codex-run.sh. This pins the entry grammar, the agent files,
// and the invariants that keep a Codex model out of an MCP-dependent role.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  RUNNER_MARKER,
  RUNNERS_FILE,
  claudeRunners,
  distinctEntries,
  loadModels,
  parseEntry,
  runnerAgent,
  runnerName,
  runnerTable,
  strayModelSlugs,
  syncRunnerAgents,
  validateModels,
} from "../tools/generate.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const pluginRoot = join(repoRoot, "plugins/pstack");
const models = loadModels();

const fixture = {
  available: [
    { label: "Fable 5.1", slug: "claude-fable-5-1", vendor: "claude" },
    { label: "Opus 5", slug: "claude-opus-5", vendor: "claude" },
    { label: "GPT-5.6 Terra", slug: "gpt-5.6-terra", vendor: "codex" },
  ],
  panel: ["claude-fable-5-1@xhigh", "gpt-5.6-terra@high"],
  roles: [],
};

describe("entry grammar", () => {
  test("parses slug, optional effort, and the vendor from the available list", () => {
    expect(parseEntry("claude-fable-5-1@xhigh", fixture)).toEqual({
      entry: "claude-fable-5-1@xhigh",
      slug: "claude-fable-5-1",
      effort: "xhigh",
      vendor: "claude",
      label: "Fable 5.1",
    });
    expect(parseEntry("gpt-5.6-terra", fixture)).toMatchObject({ slug: "gpt-5.6-terra", effort: null, vendor: "codex" });
  });

  test("rejects an unknown slug, an unknown effort, and a malformed entry", () => {
    expect(() => parseEntry("claude-haiku-9@high", fixture)).toThrow('slug "claude-haiku-9" is not in models.json');
    expect(() => parseEntry("claude-opus-5@ultra", fixture)).toThrow('effort "ultra" is not one of');
    expect(() => parseEntry("claude-opus-5@", fixture)).toThrow("is not <slug> or <slug>@<effort>");
    expect(() => parseEntry("@high", fixture)).toThrow("is not <slug> or <slug>@<effort>");
  });

  test("names the runner from the slug and effort", () => {
    expect(runnerName(parseEntry("claude-fable-5-1@xhigh", fixture))).toBe("fable-5-1-xhigh");
    expect(runnerName(parseEntry("claude-opus-5", fixture))).toBe("opus-5");
  });
});

describe("policy invariants", () => {
  test("a Claude-only role that names a Codex entry fails by role and entry", () => {
    const bad = {
      ...fixture,
      roles: [{ role: "why investigators", models: ["gpt-5.6-terra@high"], skill: "why", claudeOnly: true }],
    };
    expect(() => validateModels(bad)).toThrow('role "why investigators" is Claude-only');
    expect(() => validateModels(bad)).toThrow("gpt-5.6-terra@high");
  });

  test("a duplicate role, an empty role, and an unknown vendor fail", () => {
    const dup = { ...fixture, roles: [{ role: "x", models: ["claude-opus-5"] }, { role: "x", models: ["claude-opus-5"] }] };
    expect(() => validateModels(dup)).toThrow('role "x" appears twice');
    expect(() => validateModels({ ...fixture, roles: [{ role: "x", models: [] }] })).toThrow("names no entries");
    const vendor = { ...fixture, available: [...fixture.available, { label: "G", slug: "grok-4", vendor: "xai" }] };
    expect(() => validateModels(vendor)).toThrow('vendor "xai"');
  });

  test("a Codex slug in prose outside an owned region is a stray", () => {
    const strays = strayModelSlugs("plugins/pstack/skills/other/SKILL.md", "Prefer gpt-5.6-sol here.\n", models);
    expect(strays).toEqual(["plugins/pstack/skills/other/SKILL.md:1: Prefer gpt-5.6-sol here."]);
  });
});

describe("runner agents", () => {
  test("a Claude entry renders an agent with the model ID and effort in frontmatter", () => {
    const text = runnerAgent(parseEntry("claude-fable-5-1@xhigh", fixture));
    const front = text.match(/^---\n([\s\S]*?)\n---/)[1].split("\n");
    expect(front).toContain("name: fable-5-1-xhigh");
    expect(front).toContain("model: claude-fable-5-1");
    expect(front).toContain("effort: xhigh");
    expect(text).toContain(RUNNER_MARKER);
  });

  test("an entry with no effort renders no effort key, so the session level applies", () => {
    const text = runnerAgent(parseEntry("claude-opus-5", fixture));
    expect(text).toContain("model: claude-opus-5");
    expect(text).not.toContain("effort:");
    expect(text).toContain("at the session's effort level");
  });

  test("every Claude entry in the defaults ships as a plugin agent, byte for byte", () => {
    const runners = claudeRunners(models);
    expect(runners.length).toBeGreaterThan(0);
    for (const parsed of runners) {
      const path = join(pluginRoot, "agents", `${runnerName(parsed)}.md`);
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, "utf8")).toBe(runnerAgent(parsed));
    }
  });

  test("the hand-written agents carry no marker and are never generated", () => {
    for (const name of ["poteto-agent", "comment-sicko"]) {
      expect(readFileSync(join(pluginRoot, "agents", `${name}.md`), "utf8")).not.toContain(RUNNER_MARKER);
    }
  });

  test("sync creates, updates, removes orphans, and refuses to clobber a hand-written agent", () => {
    const dir = mkdtempSync(join(tmpdir(), "pstack-runners-"));
    try {
      const policy = { ...fixture, roles: [{ role: "a", models: ["claude-fable-5-1@xhigh", "gpt-5.6-terra@high"], skill: "x" }] };
      writeFileSync(join(dir, "stale-max.md"), `---\nname: stale-max\n---\n\n${RUNNER_MARKER}\n`);
      writeFileSync(join(dir, "poteto-agent.md"), "---\nname: poteto-agent\n---\nhand-written\n");
      expect(syncRunnerAgents(dir, policy, { log() {} })).toEqual({ stamped: 1, removed: 1, total: 1 });
      expect(existsSync(join(dir, "fable-5-1-xhigh.md"))).toBe(true);
      expect(existsSync(join(dir, "stale-max.md"))).toBe(false);
      expect(readFileSync(join(dir, "poteto-agent.md"), "utf8")).toBe("---\nname: poteto-agent\n---\nhand-written\n");
      expect(syncRunnerAgents(dir, policy, { log() {} })).toEqual({ stamped: 0, removed: 0, total: 1 });

      const collide = { ...fixture, roles: [{ role: "a", models: ["claude-opus-5"], skill: "x" }] };
      writeFileSync(join(dir, "opus-5.md"), "---\nname: opus-5\n---\nsomeone's own agent\n");
      expect(() => syncRunnerAgents(dir, collide, { log() {} })).toThrow("agents/opus-5.md: a hand-written agent has the name");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("runner table", () => {
  test("names every distinct entry once with a dispatch for its vendor", () => {
    const table = runnerTable(models);
    for (const parsed of distinctEntries(models)) {
      const rows = table.split("\n").filter((l) => l.startsWith(`| \`${parsed.entry}\` |`));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain(
        parsed.vendor === "claude"
          ? `subagent_type: "pstack:${runnerName(parsed)}"`
          : `../scripts/codex-run.sh --model ${parsed.slug}`,
      );
    }
  });

  test("the stamped table is current and every pstack: dispatch it names is a shipped agent", () => {
    const text = readFileSync(join(repoRoot, RUNNERS_FILE), "utf8");
    expect(text).toContain(runnerTable(models));
    for (const [, name] of text.matchAll(/subagent_type: "pstack:([a-z0-9-]+)"/g)) {
      expect(existsSync(join(pluginRoot, "agents", `${name}.md`))).toBe(true);
    }
  });

  test("the Codex wrapper ships executable and accepts the flags the table uses", () => {
    const script = join(pluginRoot, "skills/poteto-mode/scripts/codex-run.sh");
    expect(statSync(script).mode & 0o111).not.toBe(0);
    const text = readFileSync(script, "utf8");
    for (const flag of ["--model", "--effort", "--prompt-file", "--write", "--cwd", "--background"]) {
      expect(text).toMatch(new RegExp(`^\\s*${flag}[|)]`, "m"));
    }
    expect(text).toContain("PSTACK_CODEX_COMPANION");
  });
});
