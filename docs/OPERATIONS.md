# Operations

## Local Quality Gates

```bash
npm run lint
npm test
npm run build
npm run smoke
```

## Prompt Pipeline Gates

Compile intent IR and inspect diagnostics:

```bash
salacia prompt compile "build a todo app safely" --json
```

Run metamorphic prompt checks:

```bash
salacia prompt test --input .salacia/plans/intent-ir-<id>.json --json
```

Optimize prompt patches from evidence:

```bash
salacia prompt optimize --from-journal --json
```

## Release Gate

```bash
node scripts/release-gate.mjs --plan <plan.json> --exec <exec.json> --require-convergence
```

Local-only mode without external advisors:

```bash
node scripts/release-gate.mjs --plan <plan.json> --exec <exec.json> --require-convergence --no-external
```

GitHub Actions policy:

- Release Gate and Release workflows run mock advisor scripts only.
- No external advisor API keys are injected in GitHub workflows.
- External advisor validation remains a local/operator action, outside GitHub CI environment.

Consistency safety net check:

```bash
salacia guard consistency --json
```

Superiority audit (trust-through-evidence):

```bash
salacia audit superiority --profile docs/benchmarks/trellis-baseline.v1.json --json
```

Audit evidence is persisted to `.salacia/journal/superiority-audit-*.json`.

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
