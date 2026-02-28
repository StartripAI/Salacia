# Salacia — Agent Instructions

Salacia is a repo-first Agentic Engineering OS (TypeScript/Node.js ESM).

## IMPORTANT: Do Not Index These Directories

The following directories contain large runtime artifacts. Do NOT read, scan, or index them:

- `.salacia/` — runtime state (contracts, journal, snapshots, benchmark runs; can exceed 20GB)
- `node_modules/` — npm dependencies
- `dist/` — compiled output
- `third_party/` — vendored source mirrors
- `config/swebench_*` — large benchmark dataset files

## Build & Test

```bash
npm run build     # compile TypeScript → dist/
npm test          # run vitest test suite
npm run typecheck # type-check only
```

## Project Structure

- `src/cli/` — CLI entry point
- `src/core/` — contract, plan, converge, init, paths
- `src/adapters/` — executor/IDE bridge adapters (claude-code, codex, cursor, cline, …)
- `src/guardian/` — snapshot, rollback, drift, verify, consistency
- `src/prompt/` — compile, disambiguate, metamorphic, optimize
- `src/protocols/` — MCP server, ACP (A2A + OpenCode)
- `src/harness/` — execution harness, worktree, multi-agent
- `src/benchmark/` — benchmark runner and competitor logic
- `scripts/` — standalone Node.js utility scripts
- `tests/` — vitest test files
- `contracts/` — committed contract YAML examples
- `specs/` — committed spec markdown examples

## Environment Variables

- `ANTHROPIC_AUTH_TOKEN` — required for claude-code adapter (SDK mode)
- `CLAUDE_MODEL` — optional, defaults to `claude-opus-4-6`
