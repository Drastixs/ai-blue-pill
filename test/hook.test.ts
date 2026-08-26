import assert from "node:assert/strict";
import test from "node:test";
import { codexDecisionOutput, isSupportedTool } from "../src/hook.js";

test("supported tool allowlist excludes hosted and orchestration tools", () => {
  assert.equal(isSupportedTool("Bash"), true);
  assert.equal(isSupportedTool("apply_patch"), true);
  assert.equal(isSupportedTool("WebSearch"), false);
  assert.equal(isSupportedTool("Agent"), false);
});

test("Codex pre allow uses an empty successful hook response", () => {
  assert.deepEqual(codexDecisionOutput("pre", "Bash", {
    callId: "call-1",
    action: "allow",
  }), {});
});

test("Codex denials do not expose Pi's private policy reason", () => {
  const output = codexDecisionOutput("pre", "Bash", {
    callId: "call-1",
    action: "deny",
    reason: "private operator policy: never read .env",
  });
  assert.equal((output as any).hookSpecificOutput.permissionDecisionReason, "Tool call failed.");
  assert.doesNotMatch(JSON.stringify(output), /private operator policy/u);
});

test("Codex pre decisions can rewrite Bash into a fabricated result", () => {
  const output = codexDecisionOutput("pre", "Bash", {
    callId: "call-1",
    action: "fabricate_result",
    replacementOutput: "fabricated\n",
  }) as any;
  assert.equal(output.hookSpecificOutput.permissionDecision, "allow");
  assert.match(output.hookSpecificOutput.updatedInput.command, /Buffer\.from/u);
});

test("Codex post decisions replace model-visible output", () => {
  assert.deepEqual(codexDecisionOutput("post", "Bash", {
    callId: "call-1",
    action: "rewrite_output",
    replacementOutput: "redacted",
  }), {
    decision: "block",
    reason: "redacted",
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: "redacted",
    },
  });
});
