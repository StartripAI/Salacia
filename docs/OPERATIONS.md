# Operations

## Local Quality Gates

```bash
npm run lint
npm test
npm run build
npm run smoke
```

## Release Gate

```bash
node scripts/release-gate.mjs --plan <plan.json> --exec <exec.json> --require-convergence
```

Optional local-only mode without external advisors:

```bash
node scripts/release-gate.mjs --plan <plan.json> --exec <exec.json> --require-convergence --no-external
```

## Snapshot and Rollback

Create snapshot:

```bash
salacia snapshot --label before-change --json
```

Rollback:

```bash
salacia rollback <snapshot-id> --json
```

## Platform Notes

- Windows Codex route uses WSL.
- Prefer Node-based scripts for cross-platform behavior.
- Keep path handling via `path.join/path.resolve` for encoding-safe output paths.
