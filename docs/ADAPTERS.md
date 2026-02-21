# Adapter Guide

## Unified Bridge Contract

Every adapter uses one flow:

1. build `BridgeEnvelope`
2. dispatch with target connector
3. collect artifacts
4. validate execution result
5. write evidence to `.salacia/journal/<adapter>/...`

## Executor Adapters

### Claude Code

- Mode: `sdk` preferred, `cli` fallback.
- CLI mode requires runtime env injection.

Example:

```bash
salacia execute --adapter claude-code --mode sdk --dry-run --json
```

### Codex

- Native on macOS/Linux.
- Windows route is WSL.

```bash
salacia execute --adapter codex --mode cli --dry-run --json
```

### OpenCode

- Executor dispatch + ACP subprocess compatibility.

```bash
salacia execute --adapter opencode --mode cli --dry-run --json
```

## IDE Bridges

### Cursor

```bash
salacia execute --adapter cursor --dry-run --json
```

Creates/syncs `.cursor/rules` artifacts.

### Cline

```bash
salacia execute --adapter cline --dry-run --json
```

Creates step markdown artifacts for human approval workflow.

### VS Code

```bash
salacia execute --adapter vscode --dry-run --json
```

Writes `.vscode/tasks.json` from step verification commands.

### Antigravity

```bash
salacia execute --adapter antigravity --dry-run --json
```

Bridge-capability mode for v0.1 (rules/task/approval signal).

## Adapter Health

Use:

```bash
salacia adapters check --json
salacia adapters matrix --json
```

The matrix exposes support level, capabilities, availability, and routing notes.
