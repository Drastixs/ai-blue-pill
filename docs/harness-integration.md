# Harness integration

Status: Superseded research note

Last verified: 2026-08-24

> This document describes the earlier side-by-side benchmark concept. It is
> retained as research context only. The current product is the Pi-parent
> supervisor defined in [`product.md`](../product.md) and implemented by the
> root `src/` tree.

## Decision: JSONL subprocesses for the MVP

Run the Codex and Claude Code harnesses directly in non-interactive mode and
consume their JSON Lines output. Do not automate either terminal UI with tmux
or simulated keystrokes.

The initial provider commands are:

```bash
codex exec --json "<prompt>"
```

```bash
claude -p --output-format stream-json --verbose --include-partial-messages "<prompt>"
```

`--include-partial-messages` lets the Claude pane update while a message is
being generated. It can be omitted if whole-message events are sufficient.
The application should spawn both commands with an argument array, not through
a shell-built command string.

The two panes are application-owned renderers of real harness events. They are
not replicas of the native Codex or Claude Code terminal interfaces.

```text
                    immutable run specification
                              |
             +----------------+----------------+
             |                                 |
      isolated Codex worktree          isolated Claude worktree
       codex exec --json               claude -p ... stream-json
             |                                 |
        stdout JSONL                      stdout JSONL
             |                                 |
             +------- append-only logs --------+
                              |
                     provider adapters
                              |
                  normalized UI events
                              |
                 side-by-side live panes
```

This runs each vendor's coding-agent harness rather than replacing it with a
direct model API. It also gives the runner explicit events and process state,
which are more reliable than scraping terminal cells to detect tools, output,
or completion.

- [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive)
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)

## MVP contract

Start with one-shot runs. Each provider adapter should expose the same small
control surface:

```text
start(run_spec) -> run_id
events(run_id) -> asynchronous event stream
interrupt(run_id)
status(run_id) -> starting | running | completed | failed | interrupted
```

The immutable `run_spec` should include the provider, exact prompt bytes,
working directory, harness/model versions, timeout, environment allowlist,
and permission, sandbox, network, and tool configuration.

Store every received line before normalization. A raw record should include at
least:

```text
sequence number
runner-observed timestamp
provider and run ID
stream (stdout or stderr)
original bytes
parsed JSON, when parsing succeeds
```

Provider stdout JSONL is the source of truth for harness events. Stderr is a
separate diagnostic stream and must not be parsed as provider events. Keep the
process exit code separately as well: an exit code and a provider terminal
event are distinct evidence and can disagree.

The shared UI may consume a compact normalized vocabulary:

```text
run_started
turn_started
content_delta
tool_started
tool_completed
file_changed
usage
run_completed
run_failed
raw
```

Every normalized event must retain a reference to its raw record. Preserve
unknown provider events as `raw`; never silently discard them. Do not attempt
to normalize private reasoning or infer it from activity text. The benchmark
should compare observable messages, tool activity, repository changes, test
results, timing, and usage.

## Runner requirements

For every trial:

1. Create separate worktrees or containers from the same commit. Never let the
   two harnesses edit the same checkout.
2. Send the same prompt bytes to each adapter without simulated typing. Record
   any provider-specific wrapper text separately.
3. Read stdout and stderr concurrently so neither pipe can block the process.
4. Parse stdout one complete line at a time, while retaining the exact original
   bytes and receive order.
5. Stream normalized events to the UI over SSE or WebSockets, but render from
   stored events so a reconnect does not lose output.
6. On timeout or user cancellation, request an interrupt, wait a short grace
   period, then terminate the process. Record which stage ended the run.
7. After completion, collect the final response, repository diff, test results,
   elapsed time, exit code, and reported usage.

Pin CLI versions and keep JSONL fixtures for adapter tests. Provider schemas
can change independently, so an upgrade should be validated against fixtures
before it is used for benchmark runs.

Keep credentials in the server process environment and pass only an explicit
allowlist into each child. Redact configured secrets before records reach logs
or browsers. Prompts may also contain sensitive material; apply the same
artifact retention policy to prompts and raw events.

## What the panes do and do not show

Each pane should render provider-specific detail where useful while using the
same basic layout for both sides. A shared event vocabulary must not conceal
differences in tool calls, permission behavior, usage reporting, or failures.

The MVP does not provide:

- the exact native terminal chrome, keyboard shortcuts, menus, or pickers;
- a general interactive approval bridge;
- automatic equivalence between provider permissions or usage accounting; or
- multi-turn steering beyond provider-specific session resume support.

If exact native TUI visibility later becomes a requirement, treat it as an
additional view, not as benchmark evidence. Continue to calculate results from
structured events and repository artifacts.

## Benchmark metadata

Record at least:

- prompt bytes and prompt-template version;
- harness, model, and adapter versions;
- starting commit and worktree/container identity;
- effective instruction files, settings, tools, MCP servers, and plugins;
- permission, sandbox, and network policy;
- raw stdout and stderr records, final response, exit status, and elapsed time;
- resulting diff and test results; and
- reported token and cost usage, without assuming the providers calculate
  either metric identically.

## Future option: Agents SDK orchestration through Codex MCP

Keep the OpenAI Agents SDK as a future orchestration layer, outside the direct
MVP measurement path. Codex can expose its harness as an MCP server:

```bash
codex mcp-server
```

The server exposes `codex` to start a thread and `codex-reply` to continue it.
An Agents SDK application can call those tools to coordinate handoffs, add
guardrails, and capture orchestration traces.

- [Use Codex with the Agents SDK](https://developers.openai.com/codex/guides/agents-sdk)
- [OpenAI Agents SDK guide](https://platform.openai.com/docs/guides/agents-sdk)

This is not a drop-in replacement for the MVP runner:

- MCP presents a coarser Codex interface than Codex App Server and does not
  provide the native Codex terminal UI.
- Claude Code does not expose the same official harness-as-MCP-server
  interface. Matching this architecture would require a custom wrapper around
  the Claude Agent SDK, creating an asymmetric integration to maintain.
- An outer agent may add prompts, model calls, routing decisions, latency,
  cost, or bias. Those effects would contaminate a direct Codex-versus-Claude
  comparison if included in the measured invocation.

The safe future shape is:

```text
prompt optimizer proposes variants
                |
direct runner sends each unchanged variant to both harnesses
                |
raw events and repository artifacts are stored
                |
independent evaluator compares outcomes
```

If orchestration is added, preserve the direct subprocess runner as the
benchmark baseline. Store orchestration prompts, handoffs, traces, latency, and
cost separately from the two target harness runs.

## Later adapter upgrades

When the MVP needs interactive approvals, richer session state, or steering,
upgrade either adapter behind the same runner interface:

- Codex: [Codex App Server](https://developers.openai.com/codex/app-server)
  provides a bidirectional JSON-RPC API for threads, turns, events, and
  approvals.
- Claude: the [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview)
  provides sessions, hooks, permissions, and streaming.

These are adapter upgrades, distinct from using the OpenAI Agents SDK as an
outer orchestrator. Neither upgrade should require changing the UI's normalized
event contract or the stored benchmark record format.
