#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadEnvFile, makeRunId, shellQuote, writeJsonAtomic, ensureDir } from "./util.js";
import { parentSelection, prepareParentEnvironment } from "./parent-config.js";

const distDir = dirname(new URL(import.meta.url).pathname);
const projectDir = resolve(distDir, "../..");

function commandExists(name: string): boolean {
  return spawnSync("sh", ["-lc", `command -v ${shellQuote(name)}`], { stdio: "ignore" }).status === 0;
}

function commandVersion(command: string, args = ["--version"]): string {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() || `unavailable (exit ${result.status ?? "unknown"})`;
}

function tmux(args: string[], capture = false): string {
  const result = spawnSync("tmux", args, { encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
  if (result.status !== 0) throw new Error(`tmux ${args.join(" ")} failed${result.stderr ? `: ${result.stderr.trim()}` : ""}`);
  return capture ? result.stdout.trim() : "";
}

function parseStartArgs(args: string[]): { detach: boolean; directory: string; session: string } {
  let detach = false;
  let directory = process.cwd();
  let session = "ai-blue-pill";
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--detach") detach = true;
    else if (args[index] === "--directory") directory = args[++index] ?? directory;
    else if (args[index] === "--session") session = args[++index] ?? session;
    else if (args[index] === "--help") {
      process.stdout.write("Usage: ./start [--detach] [--directory PATH] [--session NAME]\n");
      process.exit(0);
    } else throw new Error(`Unknown option: ${args[index]}`);
  }
  return { detach, directory: resolve(directory), session };
}

function start(args: string[]): void {
  const options = parseStartArgs(args);
  const localPi = join(projectDir, "node_modules", ".bin", "pi");
  const piCommandPath = existsSync(localPi) ? localPi : "pi";
  const missing = ["tmux", "codex"].filter((name) => !commandExists(name));
  if (piCommandPath === "pi" && !commandExists("pi")) missing.push("pi (run npm install)");
  if (missing.length) {
    throw new Error(`Missing required dependencies: ${missing.join(", ")}. Install them and retry; AI Blue Pill does not install software automatically.`);
  }
  if (spawnSync("tmux", ["has-session", "-t", options.session], { stdio: "ignore" }).status === 0) {
    if (options.detach) {
      process.stdout.write(`Session ${options.session} is already running.\n`);
    } else {
      tmux(["attach-session", "-t", options.session]);
    }
    return;
  }

  const envFile = loadEnvFile(join(projectDir, ".env"));
  const runId = makeRunId();
  const runDir = join(options.directory, ".ai-blue-pill", "runs", runId);
  ensureDir(join(runDir, "pi-sessions"));
  const socketPath = join(runDir, "supervisor.sock");
  const childSession = `aibp-child-${process.pid}-${Date.now()}`;
  const { provider, model, thinking } = parentSelection(envFile);
  const parentEnvironment = prepareParentEnvironment(runDir, envFile, { provider, model, thinking });
  writeJsonAtomic(join(runDir, "run.json"), {
    runId,
    workDir: options.directory,
    parent: { provider, model, thinking },
    versions: {
      aiBluePill: "0.1.0",
      node: process.version,
      pi: commandVersion(piCommandPath),
      codex: commandVersion("codex"),
      tmux: commandVersion("tmux", ["-V"]),
    },
  });

  tmux(["new-session", "-d", "-s", options.session, "-c", options.directory, "tail -f /dev/null"]);
  const leftPane = tmux(["display-message", "-p", "-t", options.session, "#{pane_id}"], true);
  const feedCommand = `node ${shellQuote(join(distDir, "feed.js"))} ${shellQuote(join(runDir, "events.jsonl"))}`;
  const rightPane = tmux(["split-window", "-h", "-P", "-F", "#{pane_id}", "-t", leftPane, "-c", options.directory, feedCommand], true);
  tmux(["select-layout", "-t", options.session, "even-horizontal"]);
  tmux(["set-option", "-t", options.session, "@aibp_run_dir", runDir]);
  tmux(["set-option", "-t", options.session, "@aibp_viewer_pane", rightPane]);
  tmux(["set-option", "-t", options.session, "@aibp_feed_command", feedCommand]);
  tmux(["set-option", "-t", options.session, "@aibp_view", "feed"]);
  tmux(["bind-key", "-T", "prefix", "f", "run-shell", `node ${shellQuote(join(distDir, "cli.js"))} toggle-view --session ${shellQuote(options.session)}`]);

  const env = {
    ...parentEnvironment,
    AIBP_RUN_DIR: runDir,
    AIBP_SOCKET: socketPath,
    AIBP_WORKDIR: options.directory,
    AIBP_CHILD_SESSION: childSession,
    AIBP_VIEWER_PANE: rightPane,
    AIBP_CHILD_RUNNER: join(distDir, "child-runner.js"),
    AIBP_HOOK_PATH: join(distDir, "hook.js"),
  };
  const envArgs = Object.entries(env).flatMap(([key, value]) => value === undefined ? [] : [`${key}=${value}`]);
  const piCommand = [
    "env",
    ...envArgs.map(shellQuote),
    shellQuote(piCommandPath),
    "--provider", shellQuote(provider),
    "--model", shellQuote(model),
    "--thinking", shellQuote(thinking),
    "--extension", shellQuote(join(distDir, "pi-extension.js")),
    "--session-dir", shellQuote(join(runDir, "pi-sessions")),
    "--name", shellQuote(`AI Blue Pill ${runId}`),
  ].join(" ");
  tmux(["respawn-pane", "-k", "-t", leftPane, piCommand]);
  tmux(["select-pane", "-t", leftPane]);
  process.stdout.write(`AI Blue Pill run: ${runDir}\nToggle child/feed with Ctrl-b f.\n`);
  if (!options.detach) tmux(["attach-session", "-t", options.session]);
}

function toggleView(args: string[]): void {
  const index = args.indexOf("--session");
  const session = index >= 0 ? args[index + 1] : undefined;
  if (!session) throw new Error("toggle-view requires --session NAME");
  const runDir = tmux(["show-option", "-qv", "-t", session, "@aibp_run_dir"], true);
  const viewer = tmux(["show-option", "-qv", "-t", session, "@aibp_viewer_pane"], true);
  const feed = tmux(["show-option", "-qv", "-t", session, "@aibp_feed_command"], true);
  const current = tmux(["show-option", "-qv", "-t", session, "@aibp_view"], true);
  const childFile = join(runDir, "child-session");
  if (current === "native" || !existsSync(childFile)) {
    tmux(["respawn-pane", "-k", "-t", viewer, feed]);
    tmux(["set-option", "-t", session, "@aibp_view", "feed"]);
  } else {
    const childSession = readFileSync(childFile, "utf8").trim();
    tmux(["respawn-pane", "-k", "-t", viewer, `TMUX= tmux attach-session -r -t ${shellQuote(childSession)}`]);
    tmux(["set-option", "-t", session, "@aibp_view", "native"]);
  }
}

function main(): void {
  const [command = "start", ...args] = process.argv.slice(2);
  if (command === "start") start(args);
  else if (command === "toggle-view") toggleView(args);
  else throw new Error(`Unknown command: ${command}`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
