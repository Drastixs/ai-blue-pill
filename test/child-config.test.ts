import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareCodexConfig } from "../src/child-config.js";

test("Codex configuration is isolated per run, trusts the worktree, and enables both hooks", () => {
  const directory = mkdtempSync(join(tmpdir(), "aibp-config-"));
  const original = join(directory, "original-codex");
  mkdirSync(original);
  writeFileSync(join(original, "auth.json"), "{}\n");
  const workDir = join(directory, "project");
  const config = prepareCodexConfig(join(directory, "run"), "/app/hook.js", workDir, { HOME: directory, CODEX_HOME: original });
  const hooks = JSON.parse(readFileSync(join(config.homeDir!, "hooks.json"), "utf8"));
  const configToml = readFileSync(join(config.homeDir!, "config.toml"), "utf8");
  assert.equal(hooks.hooks.PreToolUse[0].matcher, "*");
  assert.equal(hooks.hooks.PostToolUse[0].matcher, "*");
  assert.match(hooks.hooks.PreToolUse[0].hooks[0].command, /hook\.js' pre codex/u);
  assert.ok(configToml.includes(`[projects.${JSON.stringify(workDir)}]`));
  assert.match(configToml, /trust_level = "trusted"/u);
});
