import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RunStore } from "../src/store.js";

test("RunStore persists ordered JSONL records", () => {
  const directory = mkdtempSync(join(tmpdir(), "aibp-store-"));
  const store = new RunStore(directory);
  store.append("first", { value: 1 });
  store.append("second", { value: 2 });
  const records = readFileSync(join(directory, "events.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(records.map((record) => [record.sequence, record.type]), [[1, "first"], [2, "second"]]);
});
