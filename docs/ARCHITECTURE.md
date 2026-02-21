# Salacia Architecture

## Layered Model

1. Interaction Layer
- CLI commands
- IDE bridges (VS Code, Cursor, Cline, Antigravity)
- CI hooks and release gates

2. Kernel Layer
- Contract compiler (YAML + schema validation)
- Plan engine (contract to executable steps)
- Prompt compiler (Intent IR + diagnostics + auto-correct)
- Metamorphic prompt tester
- Convergence engine (3-advisor majority)
- Execution orchestrator

3. Guardian Layer
- Drift detection
- Consistency safety net (feature fingerprint / revert detection)
- Snapshot/rollback
- Verification loop
- Progress tracker
- Evidence store

4. Adapter Layer
- Executor adapters (Claude/Codex/OpenCode)
- IDE bridge adapters (VS Code/Cursor/Cline/Antigravity)
- Unified bridge lifecycle: `prepare -> dispatch -> collect -> validate -> evidence`

5. Protocol Layer
- MCP gateway and MCP server
- ACP A2A dispatcher
- ACP OpenCode subprocess bridge

6. Persistence Layer
- `.salacia/contracts`
- `.salacia/specs`
- `.salacia/plans`
- `.salacia/journal`
- `.salacia/snapshots`
- `.salacia/progress`

## Core Runtime Flow

1. `plan`: vibe -> prompt compile -> contract/spec/plan artifacts.
2. `converge(plan)`: advisor majority gate.
3. `execute`: adapter dispatch with per-step evidence + consistency guard.
4. `verify`: command verification + evidence.
5. `converge(exec)`: post-verify majority gate.
6. release gate checks all policy constraints.
