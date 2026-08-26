import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parentSelection, prepareParentEnvironment } from "../src/parent-config.js";

test("custom parent endpoint gets a run-local Pi model config without persisting its key", () => {
  const runDir = mkdtempSync(join(tmpdir(), "aibp-parent-config-"));
  const fileConfig = {
    AIBP_PARENT_PROVIDER: "my-openai",
    AIBP_PARENT_MODEL: "my-model",
    AIBP_PARENT_BASE_URL: "https://example.test/v1",
    AIBP_PARENT_API_KEY: "test-secret-key",
  };
  const selection = parentSelection(fileConfig);
  const environment = prepareParentEnvironment(runDir, fileConfig, selection);
  const modelsText = readFileSync(join(environment.PI_CODING_AGENT_DIR, "models.json"), "utf8");
  const models = JSON.parse(modelsText);

  assert.equal(models.providers["my-openai"].baseUrl, "https://example.test/v1");
  assert.equal(models.providers["my-openai"].apiKey, "$AIBP_PARENT_API_KEY");
  assert.equal(models.providers["my-openai"].models[0].id, "my-model");
  assert.doesNotMatch(modelsText, /test-secret-key/u);
});
