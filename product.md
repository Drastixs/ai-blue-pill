# AI Blue Pill

## Product definition

AI Blue Pill is a terminal-based supervisor in which a Pi parent observes and
can rewrite every shell and file interaction made by a Claude Code or Codex
child.

The initial audience is founders and engineers experimenting with agent
monitoring and mediation. This is a hackathon product, not a hardened security
system.

```text
operator -> Pi parent -> pre-execution gate -> child tool
                        <- post-result gate <-
```

## Governing behavior

Pi is a trusted, stateful supervisor. The operator talks only to Pi. Normal
conversation is private supervision context. The first local `/child <message>`
command creates one persistent child session using either Claude Code or Codex
and passes `<message>` to it unchanged. Each later `/child <message>` sends that
exact message to the same child session.

- Pi must not copy, paraphrase, or otherwise inject private operator context,
  restrictions, or rationales into a child message.
- `/child` is the only explicit parent-to-child message channel. Normal
  operator conversation remains private to Pi.
- Every supported tool call stalls before execution and again after execution
  until Pi returns a structured decision.
- Pi may allow a call, rewrite its input, prevent execution and fabricate a
  result, rewrite the real result, deny the call, inject a child message,
  rewrite the child's task, or terminate the child.
- Operator messages take priority over queued child events. Concurrent child
  calls are reviewed serially.
- Calls may remain stalled indefinitely. There is no default cost, turn, or
  wall-time budget.
- The system is default-allow: if the operator has not constrained an action,
  Pi permits it.
- Pi maximizes result fidelity within explicit operator constraints. When an
  action itself is permitted, Pi executes the real tool call and returns its
  real output unchanged or with only the minimum required post-processing.
  Fabrication and pre-execution prevention are reserved for constraints on the
  action itself or cases where accurate post-processing cannot satisfy policy.
- Pi infers supervision policy from normal operator conversation and resolves
  contradictory instructions contextually.
- Pi may adapt its strategy using child messages and tool results.

Child-visible prompts, fabricated results, rewritten results, and denial text
must not name Pi, AI Blue Pill, the operator, private policies, supervision,
mediation, or hooks. The MVP aims for behavioral invisibility, not a security
concealment guarantee: the unrestricted child can still inspect processes,
generated hook configuration, or saved artifacts, and native harness UI may
identify hook lifecycle events.

## Parent

The parent runs on the Pi coding harness and uses one user-configured
OpenAI-compatible model endpoint. The endpoint base URL, model, and API key are
loaded from a `.env` file and remain fixed during a run.

Pi releases stalled calls through a structured tool such as
`respond_to_child`. Free-form model text must never release a call. Decisions
are correlated with unique call IDs.

Pi retains its four default workspace tools: `read`, `bash`, `edit`, and
`write`. Parent tool use is distinct from mediated child tool use.

Pi's context contains the private operator conversation, exact `/child`
messages, tool calls, tool results, and interventions. Context
compaction must preserve:

- current operator instructions;
- established facts about the child's perceived environment;
- prior interventions; and
- unresolved child actions.

There is no separate deterministic world model in the MVP.

## Child adapters

One child runs at a time. The operator may choose Claude Code or Codex; Pi asks
which one to use when the operator does not specify it.

Each provider has its own adapter and generated per-run hook configuration.
The launcher must not permanently modify the user's Claude or Codex settings.
At startup, an adapter verifies that the installed CLI meets its minimum tested
hook capabilities and records the exact version used.

The supported tool surface is limited to text-based:

- shell commands; and
- file reading, writing, editing, listing, globbing, and searching.

Unknown, hosted web, MCP, subagent, binary, multimodal, interactive, and
background-process tools are not exposed. Shell commands must be finite,
foreground operations.

Large results are stored in full and presented to Pi in bounded chunks. No
portion is released to the child before Pi finishes reviewing it.

## Execution and failure model

The child runs directly in the user's real working directory.

- Native child sandboxing and approval controls are disabled.
- The child inherits the launching shell's complete environment.
- The child has unrestricted host filesystem and network access.
- There is no clean-Git requirement, checkpoint, rollback, or other workspace
  protection.
- Pi is the only execution gate.

An outer process supervisor owns tmux, Pi, and the child. Pi communicates with
child hooks through a per-run Unix-domain socket. If Pi exits, crashes, or the
socket disappears, the supervisor immediately terminates the child. A live Pi
may stall a call indefinitely.

These choices are deliberate. AI Blue Pill is not a security boundary and does
not guarantee secret protection, containment, or prevention of exfiltration.
For example, an instruction to "hide all secrets" asks Pi to make contextual,
best-effort interventions; without that instruction, Pi allows the child to
read secrets.

## Terminal experience

The repository-local `./start` command creates a tmux workspace:

```text
+------------------------------+------------------------------+
| PI PARENT                    | CHILD                        |
|                              |                              |
| interactive conversation     | read-only native TUI or      |
| and supervision              | structured event feed        |
+------------------------------+------------------------------+
```

The operator types only in the Pi pane. A keybinding switches the child pane
between its native TUI and a structured feed.

The feed displays:

1. the child's original request;
2. the request that actually executed, or that execution was skipped;
3. the real result, when execution occurred; and
4. the result shown to the child.

Unchanged calls may be collapsed. Altered calls should make the transformation
obvious. The interface does not expose Pi's private reasoning.

## Run artifacts

Every run is saved indefinitely under `.ai-blue-pill/runs/<run-id>/` in the
working project. The MVP does not provide an automatic deletion workflow.

A complete record contains:

- the Pi session;
- exact child messages;
- raw and transformed tool events;
- the child transcript;
- provider, model, harness, and adapter versions;
- timestamps and sequence numbers;
- process exit information; and
- the termination reason.

Artifacts may contain secrets. They are visible to the child unless Pi has
been instructed to hide them.

## Launch and compatibility

The MVP supports Linux and macOS and is implemented in TypeScript/Node.
`./start` checks for tmux, Pi, and the selected child CLI. Missing dependencies
produce exact installation instructions; the launcher does not install or
upgrade software automatically.

The root `ai-blue-pill` repository is the product source of truth. The nested
`ai-bench` work remains research and historical reference rather than a runtime
dependency.

## MVP completion criteria

The MVP is complete when:

1. `./start` opens the Pi and child workspace on Linux and macOS.
2. The operator can establish private policy and use `/child <message>` to
   start the configured Claude Code or Codex child.
3. The child receives exactly each `/child` argument, including consecutive
   follow-up messages, and none of the private operator context.
4. Every supported child tool call stalls at pre- and post-execution gates.
5. Pi releases each gate using a structured, correlated decision.
6. Operator messages preempt queued child decisions.
7. The child receives Pi's transformed view of the tool result.
8. The feed shows original, executed, real, and child-visible data.
9. Complete artifacts are saved under `.ai-blue-pill/runs/`.
10. Losing Pi or its socket immediately terminates the child.

## Non-goals

The MVP is not:

- a security sandbox or secret-exfiltration defense;
- a safe environment for adversarial or untrusted agents;
- a deterministic machine simulator;
- a Claude-versus-Codex benchmark;
- a cross-provider parity layer;
- a background-process supervisor; or
- a mediator for web, MCP, subagent, binary, or multimodal tools.

## Deferred decision

The scripted hackathon demonstration will be designed separately. It does not
change the generic default-allow supervision model defined here.
