# Salacia

Salacia is a repo-first Agentic Engineering OS that turns vibe coding into production-grade delivery with explicit contracts, governance, and cross-executor orchestration.

## North Star
Deliver reliable software outcomes by enforcing one auditable flow:

1. Vibe -> Contract/Spec/Plan
2. Converge (3-advisor decision)
3. Execute (unified adapter bridge)
4. Verify + snapshot evidence
5. Converge again before release gates

## Quickstart (2 commands)

```bash
npm i -g salacia
salacia init
```

## CLI (v0.1)

```bash
salacia init
salacia plan "<vibe>"
salacia converge --stage plan|exec --input <path> --external --json
salacia validate --json
salacia execute --adapter <name> --dry-run --mode auto|cli|sdk --json
salacia snapshot --label <label> --json
salacia rollback [snapshot-id] --json
salacia status --json
salacia adapters list|check|matrix --json
salacia doctor --matrix --json
```

`execute` enforces `converge(plan)` before dispatch and `converge(exec)` after verification.

## Compatibility Matrix (v0.1)

### Platforms

- macOS: full support
- Linux: full support
- Windows: full support (Codex route uses WSL)

### Targets and Capabilities

| Target | Kind | Support | Capabilities | Notes |
| --- | --- | --- | --- | --- |
| claude-code | executor | ga | plan, execute, verify, rollback | SDK-first, CLI fallback |
| codex | executor | ga | plan, execute, verify, rollback | Windows route uses WSL |
| opencode | executor | beta | plan, execute, verify, rollback, bridge-status | ACP subprocess compatible |
| cursor | ide-bridge | bridge | bridge-rules, bridge-tasks, approve, bridge-status | syncs `.cursor/rules` |
| cline | ide-bridge | bridge | bridge-tasks, approve, verify, bridge-status | step markdown bridge |
| vscode | ide-bridge | bridge | bridge-rules, bridge-tasks, approve, bridge-status | writes `.vscode/tasks.json` |
| antigravity | ide-bridge | bridge | bridge-rules, bridge-tasks, approve, bridge-status | v0.1 bridge mode |

### Codex Boundaries

- Codex CLI: native on macOS/Linux, Windows through WSL
- Codex App: macOS Apple Silicon only (informational, not required by runtime)

## Architecture

- Interaction Layer: CLI, IDE bridges, CI hooks
- Kernel Layer: Contract compiler, plan engine, convergence engine, execution orchestrator
- Guardian Layer: drift detector, snapshot manager, rollback engine, verification loop, progress tracker
- Adapter Layer: unified bridge adapters for executors and IDEs
- Protocol Layer: MCP gateway/server + ACP (A2A + OpenCode subprocess)
- Persistence Layer: `.salacia/contracts`, `.salacia/specs`, `.salacia/plans`, `.salacia/journal`, `.salacia/snapshots`, `.salacia/progress`

See docs:
- [Architecture](docs/ARCHITECTURE.md)
- [Adapters](docs/ADAPTERS.md)
- [Protocols](docs/PROTOCOLS.md)
- [Operations](docs/OPERATIONS.md)
- [Release](docs/RELEASE.md)

## Convergence Policy

Three advisors participate in plan and exec stages:

- Codex (local policy advisor)
- Claude CLI (Opus 4.6)
- Gemini CLI (3.1 Pro target, fallback to available Pro model)

Rules:

- 2/3 majority required (`approve` or `reject`)
- split/abstain outcome requires human approval
- release gate fails on missing advisor evidence, malformed advisor output, or unresolved split

## Security Model

- No plaintext secrets in source, docs, templates, or logs
- Claude calls only set `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` at invocation time
- Secret scan is part of CI and release gate
- Protected paths can be blocked through contract guardrails

See [SECURITY.md](SECURITY.md) for incident response and key rotation.

## Release Policy

- Stable release in scope: GitHub release tag `v0.1.0`
- npm public publish is intentionally out of scope for this cycle
- Release is blocked unless CI and release gate pass

## License

Apache-2.0
