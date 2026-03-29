# Salacia

[![npm version](https://img.shields.io/npm/v/salacia?style=flat-square)](https://www.npmjs.com/package/salacia)
[![license](https://img.shields.io/github/license/StartripAI/Salacia?style=flat-square)](https://github.com/StartripAI/Salacia/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-1f2937?style=flat-square)](https://nodejs.org/)
[![runtime](https://img.shields.io/badge/category-agent%20harness-1366ff?style=flat-square)](https://github.com/StartripAI/Salacia)
[![surface](https://img.shields.io/badge/surface-CLI%20%2B%20MCP%20%2B%20release%20gates-18b77a?style=flat-square)](https://github.com/StartripAI/Salacia)

> **The Operating Harness for AI Coding Agents**
>
> Context, boundaries, verification, and promotion for Claude Code, Codex, Cursor, Cline, OpenCode, and more.

**Tags:** `agent-runtime` `context-pack` `judge-loop` `release-gates` `worktrees` `mcp`

AI coding agents are already strong at generating code. What they still lack is execution discipline:

- what context to load
- what files they are allowed to touch
- how the outcome is verified
- when a patch should actually be promoted

Salacia turns those concerns into runtime primitives.

It sits between your repository and your agent run, compiles a machine-readable program for the task, builds a bounded `ContextPack`, executes inside an isolated workspace, verifies the result, and emits an auditable `accept / reject / blocked` decision.

This is not just “better prompting.” It is a governable way to run coding agents inside real repositories.

## Quick Start

```bash
npx salacia init
salacia design
salacia run
```

Inspect the result:

```bash
salacia judge
salacia trace
```

## Why People Reach For Salacia

### 🧭 A bounded context, not a giant prompt

Every run gets a repository-aware `ContextPack`:

- ranked repo map
- working set and snippets
- recent run history
- explicit guardrails

Instead of forcing the agent to rediscover your codebase from scratch, Salacia gives it a bounded, high-signal map.

### ⚖️ A real verdict, not “looks good to me”

Every run ends in a hard outcome:

- `accept`
- `reject`
- `blocked`

Verification, patch surface, and policy all feed into the final decision.

### 📦 One evidence model across runtime, eval, and release

Runtime, eval, and release policy share the same evidence shape:

- inputs
- context evidence
- verification results
- judge decision
- promotion decision
- evidence refs

That means product runs, benchmarks, and release gates finally speak the same language.

## What Salacia Is

Salacia is **not** another coding agent.

It is the harness/runtime layer that makes coding agents usable inside real engineering workflows:

1. **`program.md`** declares the goal, mutable surface, verification, and promotion policy.
2. **`design`** compiles that into a machine-readable blueprint.
3. **`run`** builds a `ContextPack`, dispatches the agent in a bounded workspace, and collects the candidate patch.
4. **`judge`** decides whether the result should be accepted, rejected, or blocked.
5. **`trace`** exposes the event log, artifacts, and evidence behind that decision.

## Who It’s For

### 👨‍💻 Developers

Drop Salacia in front of the agent you already use and stop letting every run start from zero.

### 🏗️ Agent builders

Use Salacia as the execution layer beneath your coding agent, IDE bridge, or internal developer workflow.

### 🧪 Teams running evals and release gates

Reuse the same runtime evidence model for experiments, quality gates, and production policy.

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

### 🚫 Not another coding agent

Salacia does not compete with Claude Code, Codex, Cursor, or other agent products. It makes them more governable inside a real repository.

### 🧩 Not just an IDE plugin

IDE bridges are supported, but the core abstraction is the harness:

- control plane
- context plane
- judge loop
- evidence model

### 📊 Not benchmark-only infrastructure

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

## Community Links

- [Architecture](docs/ARCHITECTURE.md)
- [Operations](docs/OPERATIONS.md)
- [Adapters](docs/ADAPTERS.md)
- [Protocols](docs/PROTOCOLS.md)

## License

Apache-2.0
