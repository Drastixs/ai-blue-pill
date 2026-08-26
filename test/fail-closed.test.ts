import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error("Timed out waiting for child state");
}

test("child terminates when the Pi broker disappears", { timeout: 10_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "aibp-fail-closed-"));
  const runDir = join(root, "run");
  const binDir = join(root, "bin");
  mkdirSync(runDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  const fakeCodex = join(binDir, "codex");
  writeFileSync(fakeCodex, [
    "#!/bin/sh",
    "if [ \"$1\" = \"--version\" ]; then echo 'codex-cli 0.146.0'; exit 0; fi",
    "trap 'exit 143' TERM INT",
    "while :; do sleep 1; done",
    "",
  ].join("\n"));
  chmodSync(fakeCodex, 0o700);

  const socketPath = join(runDir, "supervisor.sock");
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    socket.once("data", () => socket.end('{"ok":true}\n'));
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(socketPath, resolveListen);
  });

  const runner = resolve("dist/src/child-runner.js");
  const child = spawn(process.execPath, [
    runner,
    "--provider", "codex",
    "--prompt-base64", Buffer.from("wait", "utf8").toString("base64"),
    "--mode", "headless",
    "--run-dir", runDir,
    "--work-dir", root,
  ], {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      AIBP_SOCKET: socketPath,
      AIBP_HOOK_PATH: resolve("dist/src/hook.js"),
    },
    stdio: "ignore",
  });

  await waitFor(() => {
    if (!existsSync(join(runDir, "child-status.json"))) return false;
    return JSON.parse(readFileSync(join(runDir, "child-status.json"), "utf8")).status === "running";
  }, 3_000);

  await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  if (existsSync(socketPath)) unlinkSync(socketPath);
  const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
    const timer = setTimeout(() => rejectExit(new Error("Child survived broker loss")), 5_000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolveExit(code);
    });
  });

  const status = JSON.parse(readFileSync(join(runDir, "child-status.json"), "utf8"));
  assert.equal(status.status, "terminated");
  assert.notEqual(exitCode, 0);
  assert.match(readFileSync(join(runDir, "terminate"), "utf8"), /supervisor unavailable/u);
});
