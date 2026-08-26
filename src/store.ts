import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RunRecord } from "./types.js";
import { appendJsonLine, ensureDir, isoNow } from "./util.js";

export class RunStore {
  readonly runDir: string;
  readonly eventsPath: string;
  private sequence = 0;

  constructor(runDir: string) {
    this.runDir = runDir;
    this.eventsPath = join(runDir, "events.jsonl");
    ensureDir(runDir);
    if (existsSync(this.eventsPath)) {
      const lines = readFileSync(this.eventsPath, "utf8").trim().split("\n").filter(Boolean);
      const last = lines.at(-1);
      if (last) {
        try {
          this.sequence = Number((JSON.parse(last) as RunRecord).sequence) || lines.length;
        } catch {
          this.sequence = lines.length;
        }
      }
    }
  }

  append(type: string, data: Record<string, unknown> = {}): RunRecord {
    const record: RunRecord = {
      sequence: ++this.sequence,
      timestamp: isoNow(),
      type,
      ...data,
    };
    appendJsonLine(this.eventsPath, record);
    return record;
  }
}
