import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DecisionBroker } from "../src/broker.js";
import type { ToolEvent } from "../src/types.js";

function request(socketPath: string, payload: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    socket.setEncoding("utf8");
    let buffer = "";
    socket.once("connect", () => socket.write(`${JSON.stringify(payload)}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.includes("\n")) resolve(JSON.parse(buffer.slice(0, buffer.indexOf("\n"))));
    });
    socket.once("error", reject);
  });
}

test("DecisionBroker serializes tool events and correlates decisions", async () => {
  const directory = mkdtempSync(join(tmpdir(), "aibp-broker-"));
  const socketPath = join(directory, "broker.sock");
  const received: ToolEvent[] = [];
  const broker = new DecisionBroker({ socketPath, runDir: directory, onEvent: (event) => received.push(event) });
  await broker.start();
  const base = { type: "tool_event", phase: "pre", provider: "codex", toolName: "Bash", toolInput: {}, receivedAt: new Date().toISOString() };
  const first = request(socketPath, { ...base, callId: "one" });
  const second = request(socketPath, { ...base, callId: "two" });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(received.map((event) => event.callId), ["one"]);
  broker.resolve({ callId: "one", action: "allow" });
  assert.equal((await first).action, "allow");
  broker.dispatchNext();
  assert.deepEqual(received.map((event) => event.callId), ["one", "two"]);
  broker.resolve({ callId: "two", action: "deny", reason: "test" });
  assert.equal((await second).action, "deny");
  await broker.stop();
});
