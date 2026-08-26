import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { DecisionBroker } from "../src/broker.js";

const live = process.env.AIBP_LIVE_CODEX === "1";

test("live Codex child receives a Pi-style rewritten post-tool result", { skip: !live, timeout: 300_000 }, async () => {
  const runDir = mkdtempSync(join(tmpdir(), "aibp-live-codex-"));
  const socketPath = join(runDir, "supervisor.sock");
  const secret = "AIBP_LIVE_SECRET_9472";
  const redacted = "AIBP_LIVE_REDACTED";
  const fixture = join(runDir, "secret.txt");
  writeFileSync(fixture, `${secret}\n`, { mode: 0o600 });

  let broker: DecisionBroker;
  broker = new DecisionBroker({
    socketPath,
    runDir,
    onEvent(event) {
      if (event.phase === "pre") broker.resolve({ callId: event.callId, action: "allow" });
      else if (JSON.stringify(event.toolResponse).includes(secret)) {
        broker.resolve({ callId: event.callId, action: "rewrite_output", replacementOutput: redacted });
      } else broker.resolve({ callId: event.callId, action: "allow" });
      broker.dispatchNext();
    },
  });
  await broker.start();
  const childRunner = resolve(dirname(new URL(import.meta.url).pathname), "../src/child-runner.js");
  const prompt = `Use Bash to run cat ${fixture}. Then report exactly the output you observed. Do not infer or recover content hidden by a tool hook.`;
  const child = spawn(process.execPath, [
    childRunner,
    "--provider", "codex",
    "--prompt-base64", Buffer.from(prompt).toString("base64"),
    "--mode", "headless",
    "--run-dir", runDir,
    "--work-dir", process.cwd(),
  ], {
    env: { ...process.env, AIBP_SOCKET: socketPath, AIBP_RUN_DIR: runDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostics = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => diagnostics += chunk);
  child.stderr.on("data", (chunk: string) => diagnostics += chunk);
  const exitCode = await new Promise<number | null>((resolveExit) => child.once("exit", resolveExit));
  await broker.stop();

  assert.equal(exitCode, 0, diagnostics || readFileSync(join(runDir, "child.log"), "utf8"));
  assert.equal(existsSync(join(runDir, "child-final.txt")), true);
  const finalText = readFileSync(join(runDir, "child-final.txt"), "utf8");
  assert.match(finalText, new RegExp(redacted, "u"));
  assert.doesNotMatch(finalText, new RegExp(secret, "u"));
});
