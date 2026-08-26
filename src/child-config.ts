import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Provider } from "./types.js";
import { ensureDir, shellQuote } from "./util.js";

export interface ChildConfig {
  homeDir?: string;
  settingsPath?: string;
  environment: NodeJS.ProcessEnv;
}

function hookCommand(hookPath: string, phase: "pre" | "post", provider: Provider): string {
  return `node ${shellQuote(hookPath)} ${phase} ${provider}`;
}

export function prepareCodexConfig(
  runDir: string,
  hookPath: string,
  workDir: string,
  baseEnvironment: NodeJS.ProcessEnv = process.env,
): ChildConfig {
  const codexHome = join(runDir, "config", "codex");
  ensureDir(codexHome);
  const originalHome = baseEnvironment.CODEX_HOME ?? join(baseEnvironment.HOME ?? "", ".codex");
  const sourceAuth = join(originalHome, "auth.json");
  const targetAuth = join(codexHome, "auth.json");
  if (existsSync(sourceAuth) && !existsSync(targetAuth)) symlinkSync(sourceAuth, targetAuth);
  const configToml = [
    "[features]",
    "hooks = true",
    "",
    `[projects.${JSON.stringify(resolve(workDir))}]`,
    'trust_level = "trusted"',
    "",
  ].join("\n");
  writeFileSync(join(codexHome, "config.toml"), configToml, { mode: 0o600 });
  const hooks = {
    description: "AI Blue Pill per-run mediation hooks",
    hooks: {
      PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand(hookPath, "pre", "codex") }] }],
      PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand(hookPath, "post", "codex") }] }],
    },
  };
  writeFileSync(join(codexHome, "hooks.json"), `${JSON.stringify(hooks, null, 2)}\n`, { mode: 0o600 });
  return { homeDir: codexHome, environment: { ...baseEnvironment, CODEX_HOME: codexHome } };
}

export function prepareClaudeConfig(
  runDir: string,
  hookPath: string,
  baseEnvironment: NodeJS.ProcessEnv = process.env,
): ChildConfig {
  const configDir = join(runDir, "config", "claude");
  ensureDir(configDir);
  const settingsPath = join(configDir, "settings.json");
  const settings = {
    hooks: {
      PreToolUse: [{ matcher: "Bash|Read|Write|Edit|Glob|Grep|LS", hooks: [{ type: "command", command: hookCommand(hookPath, "pre", "claude") }] }],
      PostToolUse: [{ matcher: "Bash|Read|Write|Edit|Glob|Grep|LS", hooks: [{ type: "command", command: hookCommand(hookPath, "post", "claude") }] }],
    },
  };
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  return { settingsPath, environment: { ...baseEnvironment } };
}
