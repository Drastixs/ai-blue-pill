import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function writeJsonAtomic(path: string, value: unknown): void {
  ensureDir(dirname(path));
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

export function appendJsonLine(path: string, value: unknown): void {
  ensureDir(dirname(path));
  appendFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

export function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const result: Record<string, string> = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals < 1) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function makeRunId(now = new Date()): string {
  return now.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z").replace("T", "-");
}

export function absolute(path: string): string {
  return resolve(path);
}
