# Salacia

> **The Harness Between Your Repo and Your Coding Agent**
>
> Give Claude Code, Codex, Cursor, Cline, or OpenCode a bounded context, a budget, and a judge.

## Quick Start

```bash
npx salacia init
salacia design
salacia run
```

Then inspect the evidence:

```bash
salacia judge
salacia trace
```

## What Salacia Does

Salacia is not another coding agent. It is the runtime/harness that sits between your repository and your agent run:

1. **`program.md`** defines the goal, mutable surface, verification, and promotion policy.
2. **`design`** compiles that into a machine-readable blueprint.
3. **`run`** builds a `ContextPack`, dispatches the agent in a bounded workspace, and runs verification.
4. **`judge`** decides whether the patch should be accepted, rejected, or blocked.
5. **`trace`** gives you the full event log and artifacts for the run.

## Three Killer Features

### 1. ContextPack

Salacia builds a repository-aware context package for every run:

- ranked repo map
- working set and snippets
- recent run history
- explicit guardrails

The agent no longer has to rediscover your repository every time.

### 2. JudgeLoop

Every run ends in a hard decision:

- `accept`
- `reject`
- `blocked`

This is not “looks good to me.” It is verification-backed promotion with automatic rollback/rejection behavior.

### 3. Evidence-Native Harness

Runtime, eval, and release gates all share the same evidence shape:

- inputs
- context evidence
- verification results
- judge decision
- promotion decision
- evidence refs

That makes product runs, benchmarks, and release policy comparable.

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

Salacia does not try to replace Claude Code, Codex, Cursor, or other agents. It gives them a better execution environment.

### Not just an IDE plugin

IDE-native bridges are supported, but the core abstraction is the harness runtime:

- control plane
- context plane
- judge loop
- evidence model

### Not benchmark-only infrastructure

Benchmarks and superiority audits are first-class, but they reuse the same runtime evidence model instead of living in a separate universe.

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
