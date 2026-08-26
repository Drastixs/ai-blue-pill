# AI Blue Pill

AI Blue Pill puts a stateful Pi agent in front of an OpenAI Codex child. Pi
sees every supported shell and file operation before and after execution, and
can allow it, rewrite it, fabricate a result, hide part of the real result, or
stop the child. Unmentioned actions are allowed by default.

This is an experimental monitoring and mediation tool, not a security sandbox.
The child runs with full host filesystem, environment, and network access.

## Prerequisites

- Node.js 22 or newer
- tmux
- [OpenAI Codex CLI](https://developers.openai.com/codex/cli/) 0.146.0 or compatible

Install the JavaScript dependencies and build:

```bash
npm install
npm run build
```

`npm install` supplies the tested Pi coding agent runtime (0.84.3). A global Pi
installation is used only as a fallback.

Authenticate both harnesses once:

```bash
codex login
pi
```

Inside Pi, run `/login`, select **OpenAI Codex**, and finish the browser/device
flow. AI Blue Pill never copies credentials between the two tools.

## Run

From the repository, or point the launcher at another project:

```bash
./start
./start --directory /path/to/project
```

The left pane is the Pi parent. First establish private supervision behavior in
normal conversation, then start the child with `/child`:

```text
Hide secrets from the child, including values in .env files and command output.

/child Inspect this project and fix the failing tests.
/child Now run the full test suite and summarize any remaining failures.
```

Normal messages remain in Pi's private context and define what it should allow,
alter, hide, or stop. The first `/child` starts one persistent child and passes
only its argument to that child, unchanged. Each later `/child` sends its exact
argument as another message to the same child. Pi then makes a structured
decision for each stalled pre- and post-tool event. `/child` is the only
explicit parent-to-child message channel.

Pi retains its built-in `read`, `bash`, `edit`, and `write` tools. Those tools
belong to the parent and are separate from the child calls passing through the
mediation hooks.

The right pane initially shows the child's native terminal read-only. Press
`Ctrl-b f` to toggle between that view and the structured mediation feed.
Use `Ctrl-b d` to detach without ending the run.

Launcher options:

```text
--detach           create or reuse the tmux session without attaching
--directory PATH   run the child in PATH
--session NAME     use a custom tmux session name
--help             show usage
```

If the named session already exists, `./start` reattaches to it. AI Blue Pill
does not install or upgrade system tools.

## Configuration

Copy `.env.example` to `.env` and edit it when needed:

```dotenv
AIBP_PARENT_PROVIDER=openai-codex
AIBP_PARENT_MODEL=gpt-5.6-sol
AIBP_PARENT_THINKING=medium
AIBP_CHILD_PROVIDER=codex
# AIBP_CODEX_MODEL=gpt-5.6-sol
```

The default parent is Pi using the OpenAI Codex OAuth provider. For a custom
OpenAI-compatible endpoint, set `AIBP_PARENT_PROVIDER` to a custom name and add
`AIBP_PARENT_BASE_URL`, `AIBP_PARENT_API_KEY`, and optionally
`AIBP_PARENT_API` (`openai-responses` by default). The launcher generates a
run-local Pi model configuration that references the key through the process
environment rather than writing it into the model file. `AIBP_CODEX_MODEL`
optionally pins the child model. `AIBP_CHILD_PROVIDER` chooses `codex` (default)
or `claude` for `/child`.

## Artifacts and safety

Each launch writes an append-only record to:

```text
<working-directory>/.ai-blue-pill/runs/<run-id>/
```

It includes the exact child messages, raw tool events, Pi decisions, child
logs, final output, generated per-run hook configuration, versions, and process
status. These artifacts can contain secrets and are retained until you remove
them manually.

The Codex configuration is isolated inside the run directory. The launcher
links the existing Codex authentication file but does not overwrite the user's
normal Codex configuration. If Pi exits or its Unix socket becomes unavailable,
the child is terminated and stalled hook calls fail closed.

## Test

Run the deterministic suite:

```bash
npm run check
npm test
```

Run the live end-to-end test after Pi and Codex are authenticated:

```bash
npm run e2e
```

The live test gives Pi a private policy, launches a real Codex process with an
exact initial `/child` message, permits a shell read, rewrites the secret-bearing post-tool
result, and verifies that Codex reports only the replacement value. Its full
evidence is retained in `.ai-blue-pill/runs/`.

See [product.md](product.md) for the full behavioral contract.
