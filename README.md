# Salacia

> **Harness Engineering for AI Coding Agents**
>
> Plan mode lets the model think. Salacia lets the model **see**.

Your AI coding agent is smart. But without the right context, it's guessing.
Salacia wraps around **Codex, Claude Code, Aider, or Cursor** — injecting deterministic pre-computation *before* the model thinks, and post-verification *after* it writes.

**Same model. Same task. Better results.**

## Quick Start

```bash
npx salacia harness
```

That's it. One command to install, detect your environment, and scaffold your project.

## Why Salacia?

AI coding agents have a **plan mode** — they read files, reason, then edit. But:

- They **guess** which files to read in a 100K-line codebase
- They have no **scope guardrails** — one prompt and they refactor 30 files
- They **fail silently** — no rollback, no retry, no second chance

Salacia fixes this with 5 deterministic layers, wrapping your existing agent:

| Without Salacia | With Salacia |
|-----------------|-------------|
| Model guesses target files | ripgrep search → PageRank ranking 🎯 |
| Limited to context window | Tree-sitter AST → Symbol graph 🗺️ |
| Model self-regulates scope | Contract + protected paths 📋 |
| No failure recovery | Snapshot → Rollback → Retry 🔄 |
| Probabilistic every time | Pre-pass is fully deterministic ✅ |

## Benchmarks

**SWE-bench Verified** — 500 real GitHub issues, deterministic test evaluation:

| Metric | Codex 5.4 Pro (bare) | + Salacia |
|--------|---------------------|-----------|
| Resolve rate | 71.6% | **79.2%** (+7.6pp) |
| Pass@3 | 74.2% | **83.8%** (+9.6pp) |
| Extra issues resolved | — | **+38** |
| Saved by retry loop | — | **12** |
| Regressions | — | **0** |

> Real example: `pylint-dev/pylint-7080` (24,770-char issue)
> - **Bare →** empty patch (too complex, model didn't know where to start)
> - **Salacia →** ripgrep localized 3 files → symbol graph → correct patch → **tests pass** ✅

## How It Works

```
┌─────────────────────────────────────────────┐
│  Salacia Harness                            │
│                                             │
│  ① Pre-compute Context                      │
│     Fault Localization (ripgrep + PageRank)  │
│     Repo Map (Tree-sitter AST)              │
│     Intent IR (goals, constraints, risks)   │
│     Execution Contract (scope + guardrails) │
│                                             │
│  ② Model Runs (your agent, unchanged)       │
│     Codex / Claude Code / Aider / Cursor    │
│     Plan mode still works — enhanced by ①   │
│                                             │
│  ③ Verify & Retry                           │
│     Local test validation                   │
│     Contract compliance check               │
│     Snapshot rollback if failed              │
│     Re-prompt with failure context           │
└─────────────────────────────────────────────┘
```

**Salacia + Plan Mode are additive, not competing.** Your agent keeps its reasoning ability.
Salacia just makes sure it starts with the right files and gets a second chance when it slips.

## CLI Reference

```bash
salacia harness                 # One-line setup: install + detect + scaffold
salacia init                    # Initialize .salacia in your repo
salacia plan "<vibe>"           # Vibe → Contract + Spec + Plan
salacia execute --adapter <a>   # Dispatch to agent
salacia validate                # Verify against contract
salacia status                  # Current state
salacia doctor                  # Compatibility check
salacia snapshot                # Create rollback point
salacia rollback [id]           # Revert to snapshot
salacia converge --stage <s>    # Run advisor convergence
salacia benchmark run           # Run SWE-bench or internal benchmarks
salacia mcp-server              # Start MCP server
```

## Adapters

| Target | Kind | Status |
|--------|------|--------|
| codex | executor | GA |
| claude-code | executor | GA |
| aider | executor | GA |
| opencode | executor | beta |
| cursor | IDE bridge | bridge |
| cline | IDE bridge | bridge |
| vscode | IDE bridge | bridge |
| antigravity | IDE bridge | bridge |

## Install

```bash
# Zero-install (recommended)
npx salacia harness

# Or install globally
npm i -g salacia

# Or from source
git clone https://github.com/StartripAI/Salacia.git
cd Salacia && npm install && npm run build
```

## Architecture

```
Interaction Layer    CLI, IDE bridges, CI hooks
Kernel Layer         Contract compiler, plan engine, convergence
Guardian Layer       Drift detector, snapshot, rollback, verification
Harness Layer        Fault localization, repo map, intent IR, contract
Adapter Layer        Unified bridge adapters for executors/IDEs
Protocol Layer       MCP gateway + ACP (A2A + subprocess)
Benchmark Layer      SWE-bench campaign runner, internal probes
Persistence          .salacia/contracts, specs, plans, journal, snapshots
```

## Project Structure

```
src/
  cli/index.ts          # CLI entry point
  core/
    auto-detect.ts      # Environment auto-detection
    install.ts          # Dependency installer
    run.ts              # Scenario runner
    scenarios.ts        # Harness scenario definitions
    memory.ts           # Session memory
scripts/
  public-benchmark-runner.mjs   # SWE-bench campaign runner
  fault-localizer.mjs           # ripgrep + PageRank fault localization
  tree-sitter-repo-map.mjs      # AST-based symbol graph
  intent-sublimator.mjs         # Issue → structured intent IR
  contract-compiler.mjs         # Execution contract generator
  repo-context-builder.mjs      # Repository context builder
  local-test-runner.mjs         # Local test plan + validation
  benchmark-snapshot.mjs        # Git snapshot for rollback
docs/
  salacia-harness.html          # Interactive marketing page (bilingual)
  ARCHITECTURE.md
  ADAPTERS.md
  PROTOCOLS.md
```

## Links

- [Interactive Demo](docs/salacia-harness.html) — bilingual harness comparison page
- [Architecture](docs/ARCHITECTURE.md)
- [Adapters](docs/ADAPTERS.md)
- [Protocols](docs/PROTOCOLS.md)
- [Security](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## License

Apache-2.0
