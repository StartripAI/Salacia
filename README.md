# Salacia

> **The Runtime for AI Coding Agents**
>
> Your code runs on Node. Your AI agent runs on Salacia.

## 5 Seconds to Start

```bash
npx salacia init
```

## 1 Minute to Learn

```bash
# Tell it what you want (natural language)
npx salacia plan "add JWT authentication"

# Dispatch to your AI coding agent
npx salacia execute --adapter claude-code

# Verify the result against the contract
npx salacia validate
```

## What Just Happened?

1. **`plan`** — Salacia parsed your vibe into a Contract (what) + Spec (how) + Plan (steps), then pre-analyzed your codebase with fault localization
2. **`execute`** — Dispatched to Claude Code with targeted context — the agent reads fewer files, wastes fewer tokens, and fixes bugs faster
3. **`validate`** — Verified results against the contract, not just "it compiles"

**Result:** Same model, same task — agents with Salacia solve **+6% more bugs** while using **fewer tokens** ([see benchmarks](#benchmarks)).

## Why Salacia?

Salacia is **not** another AI coding agent. It's the layer that makes your existing agents better:

| Without Salacia | With Salacia |
|-----------------|-------------|
| Agent searches entire repo | Agent reads 2-3 targeted files |
| 10+ turns of trial and error | 3-5 focused turns |
| Wastes tokens on wrong files | 93% accurate fault localization |
| "It compiled" = done | Contract-verified correctness |

## Benchmarks

Tested on **117 SWE-bench Verified tasks** across two models:

| Metric | Value |
|--------|-------|
| Pass rate uplift | **+6pp** (56.4% → 62.4%) |
| Win : Fallback ratio | **2.2 : 1** |
| FL accuracy (Top-5) | **93%** |
| Both models improved | ✅ Sonnet +6.9pp, Opus +3.3pp |

## CLI Reference

```bash
salacia init                    # Initialize .salacia in your repo
salacia plan "<vibe>"           # Vibe → Contract + Spec + Plan
salacia execute --adapter <a>   # Dispatch to agent
salacia validate                # Verify against contract
salacia status                  # Current state
salacia doctor                  # Compatibility check
salacia snapshot                # Create rollback point
salacia rollback [id]           # Revert to snapshot
salacia converge --stage <s>    # Run advisor convergence
salacia adapters list           # Show available adapters
salacia benchmark <action>      # Run benchmarks
salacia mcp-server              # Start MCP server
```

## Adapters

| Target | Kind | Status |
|--------|------|--------|
| claude-code | executor | GA |
| codex | executor | GA |
| opencode | executor | beta |
| cursor | IDE bridge | bridge |
| cline | IDE bridge | bridge |
| vscode | IDE bridge | bridge |
| antigravity | IDE bridge | bridge |

## Install

```bash
# Use without install
npx salacia init

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
Adapter Layer        Unified bridge adapters for executors/IDEs
Protocol Layer       MCP gateway + ACP (A2A + subprocess)
Persistence          .salacia/contracts, specs, plans, journal, snapshots
```

## Links

- [Architecture](docs/ARCHITECTURE.md)
- [Adapters](docs/ADAPTERS.md)
- [Protocols](docs/PROTOCOLS.md)
- [Security](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## License

Apache-2.0
