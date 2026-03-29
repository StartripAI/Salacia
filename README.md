# Salacia

> **The Operating Harness for AI Coding Agents**
>
> Context, boundaries, verification, and promotion for Claude Code, Codex, Cursor, Cline, OpenCode, and more.

AI coding agents are already good at writing code. What they still lack is execution discipline: what context to load, what files they are allowed to touch, how the result is judged, and when a patch should actually be promoted.

Salacia turns those concerns into runtime primitives.

It sits between your repository and your agent run, compiles a machine-readable program for the task, builds a bounded `ContextPack`, executes inside an isolated workspace, verifies the outcome, and emits an auditable `accept / reject / blocked` decision. The result is not just a more capable agent run. It is a governable one.

## Quick Start

```bash
npx salacia init
salacia design
salacia run
```

Then inspect the decision and trace:

```bash
salacia judge
salacia trace
```

## What Salacia Is

Salacia is not another coding agent.

It is the harness/runtime layer that makes coding agents usable inside real repositories:

1. **`program.md`** declares the goal, mutable surface, verification, and promotion policy.
2. **`design`** compiles that into a machine-readable blueprint.
3. **`run`** builds a `ContextPack`, dispatches the agent in a bounded workspace, and collects the candidate patch.
4. **`judge`** decides whether the result should be accepted, rejected, or blocked.
5. **`trace`** exposes the event log, artifacts, and evidence behind that decision.

## Three Defining Capabilities

### 1. ContextPack

Every run gets a repository-aware context package:

- ranked repo map
- working set and code snippets
- recent run history
- explicit guardrails

Instead of forcing the agent to rediscover your codebase from scratch, Salacia gives it a bounded, high-signal execution context.

### 2. JudgeLoop

Every run ends in a hard outcome:

- `accept`
- `reject`
- `blocked`

No “looks good to me.” No silent drift from generated patch to promoted patch. Verification, policy, and patch surface all feed into the final decision.

### 3. Evidence-Native Harness

Runtime, eval, and release policy share the same evidence model:

- inputs
- context evidence
- verification results
- judge decision
- promotion decision
- evidence refs

That means product runs, benchmarks, and release gates are finally speaking the same language.

## Why Teams Reach For Salacia

### Raw agents are powerful, but fragile

Without a harness, coding agents tend to:

- over-read the repository
- over-edit beyond the intended surface
- mix generation with promotion
- blur product runs and benchmark runs into incompatible traces

Salacia makes those concerns explicit and enforceable.

### The right abstraction is not “better prompting”

The real bottleneck in serious codebase work is not prompt cleverness. It is runtime structure:

- what the agent is allowed to see
- what it is allowed to change
- how success is verified
- how failure is contained

Salacia is designed around that runtime layer.

## How a Run Works

```text
program.md
  -> blueprint
  -> context pack
  -> isolated run
  -> verification
  -> judge
  -> promote / reject / block
```

Artifacts produced by a run:

- `program.md`
- `.salacia/blueprint.json`
- `.salacia/context/<run-id>.json`
- `.salacia/runs/<run-id>/events.ndjson`
- `.salacia/runs/<run-id>/summary.json`
- `.salacia/runs/<run-id>/judge.json`

## Why This Is Different

### Not another coding agent

Salacia does not compete with Claude Code, Codex, Cursor, or other agent products. It makes them more governable inside a real engineering workflow.

### Not just an IDE plugin

IDE bridges are supported, but the core abstraction is the harness:

- control plane
- context plane
- judge loop
- evidence model

### Not benchmark-only infrastructure

Benchmarks and superiority audits are first-class, but they reuse the same runtime evidence model instead of living in a separate reporting universe.

## CLI Surface

```bash
salacia init
salacia design
salacia run [--adapter <name>]
salacia judge [--run <id>]
salacia trace [--run <id>]
salacia eval <action>
```

Legacy v0.1 commands such as `plan`, `execute`, and `validate` remain available only as transitional surfaces.

## Works With

- Claude Code
- Codex
- OpenCode
- Cursor
- Cline
- VS Code bridges
- Antigravity

## Architecture

Salacia v0.2 is organized around four planes:

- `control plane`: `program.md` -> blueprint
- `context plane`: repo map, working set, history, guardrails
- `harness plane`: run session, verification, judge, promotion
- `eval plane`: benchmark, superiority, release gate consumption

## Links

- [Architecture](docs/ARCHITECTURE.md)
- [Operations](docs/OPERATIONS.md)
- [Adapters](docs/ADAPTERS.md)
- [Protocols](docs/PROTOCOLS.md)

## License

Apache-2.0
