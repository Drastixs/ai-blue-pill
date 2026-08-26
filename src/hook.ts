#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import type { Provider, ToolDecision, ToolEvent } from "./types.js";
import { isoNow } from "./util.js";

const SUPPORTED = /^(Bash|apply_patch|Read|Write|Edit|Glob|Grep|LS|read_file|write_file|edit_file|list_dir|glob|grep)$/u;
const CHILD_VISIBLE_FAILURE = "Tool call failed.";

export function isSupportedTool(name: string): boolean {
  return SUPPORTED.test(name);
}

export function codexDecisionOutput(phase: "pre" | "post", toolName: string, decision: ToolDecision): unknown {
  if (phase === "pre") {
    if (decision.action === "allow") {
      // Codex treats exit 0 with no decision fields as an allow. The
      // permissionDecision "allow" shape is only valid when paired with
      // updatedInput; returning it alone makes the hook fail open.
      return {};
    }
    if (decision.action === "rewrite_input") {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          updatedInput: decision.updatedInput,
        },
      };
    }
    if (decision.action === "fabricate_result" && toolName === "Bash") {
      const encoded = Buffer.from(decision.replacementOutput ?? "", "utf8").toString("base64");
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          updatedInput: { command: `node -e 'process.stdout.write(Buffer.from("${encoded}","base64"))'` },
        },
      };
    }
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: CHILD_VISIBLE_FAILURE,
      },
    };
  }

  if (decision.action === "allow") return {};
  if (decision.action === "rewrite_output" || decision.action === "fabricate_result") {
    return {
      decision: "block",
      reason: decision.replacementOutput ?? "",
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: decision.replacementOutput ?? "",
      },
    };
  }
  return {
    decision: "block",
    reason: CHILD_VISIBLE_FAILURE,
  };
}

export function claudeDecisionOutput(phase: "pre" | "post", decision: ToolDecision): unknown {
  if (phase === "pre") {
    if (decision.action === "allow") {
      return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } };
    }
    if (decision.action === "rewrite_input") {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          updatedInput: decision.updatedInput,
        },
      };
    }
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: CHILD_VISIBLE_FAILURE,
      },
    };
  }
  if (decision.action === "allow") return {};
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      updatedOutput: decision.replacementOutput ?? CHILD_VISIBLE_FAILURE,
    },
  };
}

function failClosed(provider: Provider, phase: "pre" | "post", reason: string): unknown {
  const decision: ToolDecision = { callId: "unavailable", action: "terminate", reason };
  return provider === "codex"
    ? codexDecisionOutput(phase, "", decision)
    : claudeDecisionOutput(phase, decision);
}

async function askBroker(socketPath: string, event: ToolEvent): Promise<ToolDecision> {
  return new Promise<ToolDecision>((resolve, reject) => {
    const socket = connect(socketPath);
    socket.setEncoding("utf8");
    let buffer = "";
    socket.once("connect", () => socket.write(`${JSON.stringify(event)}\n`));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        resolve(JSON.parse(buffer.slice(0, newline)) as ToolDecision);
      } catch (error) {
        reject(error);
      } finally {
        socket.end();
      }
    });
    socket.once("error", reject);
    socket.once("end", () => {
      if (!buffer.includes("\n")) reject(new Error("Pi supervisor closed the socket without a decision"));
    });
  });
}

export async function runHook(
  phase: "pre" | "post",
  provider: Provider,
  rawInput: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<unknown> {
  const input = JSON.parse(rawInput) as Record<string, unknown>;
  const toolName = String(input.tool_name ?? input.toolName ?? "unknown");
  if (!isSupportedTool(toolName)) {
    if (phase === "post") return {};
    const unsupported: ToolDecision = {
      callId: "unsupported",
      action: "deny",
      reason: `AI Blue Pill does not expose unsupported tool: ${toolName}`,
    };
    return provider === "codex"
      ? codexDecisionOutput(phase, toolName, unsupported)
      : claudeDecisionOutput(phase, unsupported);
  }

  const socketPath = environment.AIBP_SOCKET;
  if (!socketPath) return failClosed(provider, phase, "AI Blue Pill socket is not configured");
  const toolUseId = String(input.tool_use_id ?? input.toolUseId ?? `${Date.now()}-${process.pid}`);
  const event: ToolEvent = {
    type: "tool_event",
    callId: `${provider}:${toolUseId}:${phase}`,
    phase,
    provider,
    toolName,
    toolInput: input.tool_input ?? input.toolInput ?? {},
    toolResponse: phase === "post" ? input.tool_response ?? input.toolResponse : undefined,
    sessionId: input.session_id ? String(input.session_id) : undefined,
    turnId: input.turn_id ? String(input.turn_id) : undefined,
    cwd: input.cwd ? String(input.cwd) : undefined,
    receivedAt: isoNow(),
  };

  try {
    const decision = await askBroker(socketPath, event);
    if (decision.action === "terminate" && environment.AIBP_RUN_DIR) {
      writeFileSync(join(environment.AIBP_RUN_DIR, "terminate"), `${decision.reason ?? "terminated"}\n`);
    }
    return provider === "codex"
      ? codexDecisionOutput(phase, toolName, decision)
      : claudeDecisionOutput(phase, decision);
  } catch (error) {
    if (environment.AIBP_RUN_DIR) {
      const path = join(environment.AIBP_RUN_DIR, "hook-errors.log");
      appendFileSync(path, `${isoNow()} ${error instanceof Error ? error.stack : String(error)}\n`);
      if (!existsSync(join(environment.AIBP_RUN_DIR, "terminate"))) {
        writeFileSync(join(environment.AIBP_RUN_DIR, "terminate"), "Pi supervisor unavailable\n");
      }
    }
    return failClosed(provider, phase, "Pi supervisor unavailable; child is terminating");
  }
}

async function main(): Promise<void> {
  const [phaseArg, providerArg] = process.argv.slice(2);
  if ((phaseArg !== "pre" && phaseArg !== "post") || (providerArg !== "codex" && providerArg !== "claude")) {
    throw new Error("Usage: hook <pre|post> <codex|claude>");
  }
  const raw = readFileSync(0, "utf8");
  const output = await runHook(phaseArg, providerArg, raw);
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 2;
  });
}
