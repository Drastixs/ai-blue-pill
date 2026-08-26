#!/usr/bin/env node
import { createWriteStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { prepareClaudeConfig, prepareCodexConfig } from "./child-config.js";
import type { ChildStatus, Provider } from "./types.js";
import { isoNow, writeJsonAtomic } from "./util.js";

interface Options {
  provider: Provider;
  prompt: string;
  mode: "tui" | "headless";
  runDir: string;
  workDir: string;
}

const MIN_CODEX_VERSION = [0, 146, 0] as const;

function commandVersion(command: string): string {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} --version failed: ${(result.stderr || result.stdout).trim()}`);
  return `${result.stdout}${result.stderr}`.trim();
}

function assertSupportedCodex(versionText: string): void {
  const match = versionText.match(/(\d+)\.(\d+)\.(\d+)/u);
  if (!match) throw new Error(`Could not parse Codex version: ${versionText}`);
  const actual = match.slice(1, 4).map(Number);
  for (let index = 0; index < MIN_CODEX_VERSION.length; index += 1) {
    if (actual[index] > MIN_CODEX_VERSION[index]) return;
    if (actual[index] < MIN_CODEX_VERSION[index]) {
      throw new Error(`Codex ${versionText} is too old; AI Blue Pill requires 0.146.0 or newer for mediation hooks.`);
    }
  }
}

function parseArgs(argv: string[]): Options {
  const get = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const provider = get("--provider");
  if (provider !== "codex" && provider !== "claude") throw new Error("--provider must be codex or claude");
  const encoded = get("--prompt-base64");
  if (!encoded) throw new Error("--prompt-base64 is required");
  const mode = get("--mode") === "tui" ? "tui" : "headless";
  const runDir = resolve(get("--run-dir") ?? process.env.AIBP_RUN_DIR ?? "");
  const workDir = resolve(get("--work-dir") ?? process.env.AIBP_WORKDIR ?? process.cwd());
  return { provider, prompt: Buffer.from(encoded, "base64").toString("utf8"), mode, runDir, workDir };
}

function health(socketPath: string): Promise<boolean> {
  return new Promise((resolveHealth) => {
    const socket = connect(socketPath);
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveHealth(value);
    };
    socket.setEncoding("utf8");
    socket.setTimeout(750);
    socket.once("connect", () => socket.write('{"type":"health"}\n'));
    socket.once("data", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.once("end", () => finish(false));
  });
}

export async function runChild(options: Options): Promise<number> {
  const { provider, prompt, mode, runDir, workDir } = options;
  const socketPath = process.env.AIBP_SOCKET ?? join(runDir, "supervisor.sock");
  const hookPath = process.env.AIBP_HOOK_PATH ?? resolve(new URL("./hook.js", import.meta.url).pathname);
  const statusPath = join(runDir, "child-status.json");
  const startedAt = isoNow();
  writeJsonAtomic(statusPath, { status: "starting", provider, startedAt } satisfies ChildStatus);

  let command: string;
  let args: string[];
  let environment: NodeJS.ProcessEnv;
  let harnessVersion: string;
  if (provider === "codex") {
    const config = prepareCodexConfig(runDir, hookPath, workDir, { ...process.env, AIBP_SOCKET: socketPath, AIBP_RUN_DIR: runDir });
    command = "codex";
    harnessVersion = commandVersion(command);
    assertSupportedCodex(harnessVersion);
    const model = process.env.AIBP_CODEX_MODEL;
    const common = [
      "--dangerously-bypass-hook-trust",
      ...(model ? ["--model", model] : []),
    ];
    args = mode === "tui"
      ? [...common, "--dangerously-bypass-approvals-and-sandbox", "--no-alt-screen", "-C", workDir, prompt]
      : [...common, "exec", "--json", "--dangerously-bypass-approvals-and-sandbox", "-C", workDir, "-o", join(runDir, "child-final.txt"), prompt];
    environment = config.environment;
  } else {
    const config = prepareClaudeConfig(runDir, hookPath, { ...process.env, AIBP_SOCKET: socketPath, AIBP_RUN_DIR: runDir });
    command = "claude";
    harnessVersion = commandVersion(command);
    const common = ["--dangerously-skip-permissions", "--settings", config.settingsPath!];
    args = mode === "tui"
      ? [...common, prompt]
      : [...common, "--print", "--output-format", "stream-json", "--verbose", prompt];
    environment = config.environment;
  }

  writeJsonAtomic(join(runDir, "child-runtime.json"), {
    provider,
    harnessVersion,
    adapterVersion: "0.1.0",
    mode,
    command,
    args,
    workDir,
    startedAt,
  });

  const log = createWriteStream(join(runDir, "child.log"), { flags: "a", mode: 0o600 });
  const child = spawn(command, args, {
    cwd: workDir,
    env: environment,
    stdio: mode === "tui" ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  if (mode === "headless") {
    child.stdout!.on("data", (chunk) => log.write(chunk));
    child.stderr!.on("data", (chunk) => log.write(chunk));
  }
  writeJsonAtomic(statusPath, { status: "running", provider, pid: child.pid, startedAt } satisfies ChildStatus);

  let failures = 0;
  const monitor = setInterval(async () => {
    if (existsSync(join(runDir, "terminate"))) {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1500).unref();
      return;
    }
    if (await health(socketPath)) failures = 0;
    else failures += 1;
    if (failures >= 2) {
      if (!existsSync(join(runDir, "terminate"))) {
        writeFileSync(join(runDir, "terminate"), "Pi supervisor unavailable\n", { mode: 0o600 });
      }
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1500).unref();
    }
  }, 500);

  return new Promise<number>((resolveExit) => {
    child.once("error", (error) => {
      clearInterval(monitor);
      log.end();
      writeJsonAtomic(statusPath, {
        status: "failed",
        provider,
        startedAt,
        finishedAt: isoNow(),
        message: error.message,
      } satisfies ChildStatus);
      resolveExit(1);
    });
    child.once("exit", (code, signal) => {
      clearInterval(monitor);
      log.end();
      const terminated = existsSync(join(runDir, "terminate"));
      writeJsonAtomic(statusPath, {
        status: terminated ? "terminated" : code === 0 ? "completed" : "failed",
        provider,
        pid: child.pid,
        exitCode: code,
        signal,
        startedAt,
        finishedAt: isoNow(),
      } satisfies ChildStatus);
      resolveExit(code ?? (signal ? 1 : 0));
    });
  });
}

async function main(): Promise<void> {
  const code = await runChild(parseArgs(process.argv.slice(2)));
  process.exitCode = code;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
