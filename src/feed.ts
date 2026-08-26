#!/usr/bin/env node
import { existsSync, openSync, readSync, closeSync } from "node:fs";
import { basename } from "node:path";

const color = {
  cyan: "\u001b[36m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  red: "\u001b[31m",
  dim: "\u001b[2m",
  reset: "\u001b[0m",
};

function summarize(value: unknown, max = 1000): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function formatRecord(record: Record<string, unknown>): string {
  const sequence = String(record.sequence ?? "?").padStart(4, "0");
  if (record.type === "tool_event") {
    const event = record.event as Record<string, unknown>;
    const phase = event.phase === "pre" ? `${color.cyan}PRE ` : `${color.yellow}POST`;
    const body = event.phase === "pre" ? event.toolInput : event.toolResponse;
    return `${color.dim}${sequence}${color.reset} ${phase}${color.reset} ${event.provider}/${event.toolName}\n${summarize(body)}`;
  }
  if (record.type === "tool_decision") {
    const decision = record.decision as Record<string, unknown>;
    const changed = decision.action !== "allow";
    return `${color.dim}${sequence}${color.reset} ${changed ? color.red : color.green}${String(decision.action).toUpperCase()}${color.reset} ${decision.callId}\n${summarize(decision.updatedInput ?? decision.replacementOutput ?? decision.reason ?? "")}`;
  }
  return `${color.dim}${sequence}${color.reset} ${String(record.type)} ${summarize(record)}`;
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) throw new Error("Usage: feed <events.jsonl>");
  process.stdout.write(`AI Blue Pill feed: ${basename(path)}\n\n`);
  let offset = 0;
  let remainder = "";
  for (;;) {
    if (existsSync(path)) {
      const fd = openSync(path, "r");
      const chunk = Buffer.alloc(64 * 1024);
      let bytes = 0;
      do {
        bytes = readSync(fd, chunk, 0, chunk.length, offset);
        if (bytes > 0) {
          offset += bytes;
          remainder += chunk.subarray(0, bytes).toString("utf8");
          const lines = remainder.split("\n");
          remainder = lines.pop() ?? "";
          for (const line of lines) {
            if (!line) continue;
            try {
              process.stdout.write(`${formatRecord(JSON.parse(line) as Record<string, unknown>)}\n\n`);
            } catch {
              process.stdout.write(`${line}\n`);
            }
          }
        }
      } while (bytes > 0);
      closeSync(fd);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
