import { existsSync, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import type { BrokerRequest, ToolDecision, ToolEvent } from "./types.js";
import { ensureDir } from "./util.js";
import { RunStore } from "./store.js";

interface PendingCall {
  event: ToolEvent;
  socket: Socket;
}

export interface DecisionBrokerOptions {
  socketPath: string;
  runDir: string;
  onEvent: (event: ToolEvent) => void;
  maxRequestBytes?: number;
  store?: RunStore;
}

export class DecisionBroker {
  private readonly socketPath: string;
  private readonly onEvent: (event: ToolEvent) => void;
  private readonly maxRequestBytes: number;
  private readonly store: RunStore;
  private server?: Server;
  private queue: PendingCall[] = [];
  private active?: PendingCall;

  constructor(options: DecisionBrokerOptions) {
    this.socketPath = options.socketPath;
    this.onEvent = options.onEvent;
    this.maxRequestBytes = options.maxRequestBytes ?? 16 * 1024 * 1024;
    this.store = options.store ?? new RunStore(options.runDir);
  }

  get activeCallId(): string | undefined {
    return this.active?.event.callId;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  async start(): Promise<void> {
    if (this.server) return;
    ensureDir(dirname(this.socketPath));
    if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
    this.server = createServer((socket) => this.accept(socket));
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.socketPath, () => {
        this.server!.off("error", reject);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    for (const pending of [this.active, ...this.queue]) {
      if (!pending) continue;
      pending.socket.end(`${JSON.stringify({
        callId: pending.event.callId,
        action: "terminate",
        reason: "Pi supervisor stopped",
      })}\n`);
    }
    this.active = undefined;
    this.queue = [];
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
  }

  resolve(decision: ToolDecision): void {
    if (!this.active || this.active.event.callId !== decision.callId) {
      throw new Error(`No active child call with id ${decision.callId}`);
    }
    this.store.append("tool_decision", { decision, event: this.active.event });
    this.active.socket.end(`${JSON.stringify(decision)}\n`);
    this.active = undefined;
  }

  dispatchNext(): void {
    if (this.active || this.queue.length === 0) return;
    this.active = this.queue.shift();
    if (this.active) this.onEvent(this.active.event);
  }

  private accept(socket: Socket): void {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > this.maxRequestBytes) {
        socket.end(`${JSON.stringify({ error: "request_too_large" })}\n`);
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      socket.removeAllListeners("data");
      this.handleLine(socket, line);
    });
  }

  private handleLine(socket: Socket, line: string): void {
    let request: BrokerRequest;
    try {
      request = JSON.parse(line) as BrokerRequest;
    } catch {
      socket.end(`${JSON.stringify({ error: "invalid_json" })}\n`);
      return;
    }
    if (request.type === "health") {
      socket.end(`${JSON.stringify({ ok: true })}\n`);
      return;
    }
    if (request.type !== "tool_event" || !request.callId || !request.phase) {
      socket.end(`${JSON.stringify({ error: "invalid_event" })}\n`);
      return;
    }
    this.store.append("tool_event", { event: request });
    this.queue.push({ event: request, socket });
    this.dispatchNext();
  }
}
