# Release Procedure

## Stable v0.1.0 Flow

1. Create/update integration branch `codex/salacia-v0.1-final`.
2. Pass CI matrix (`ubuntu/macos/windows` x `node 20/22/24`).
3. Run release gate with convergence evidence.
4. Merge to `main` via PR.
5. Tag `v0.1.0`.
6. Publish GitHub Release with changelog and evidence links.

## Mandatory Gate Conditions

- lint/test/build/smoke green
- secret scan green
- convergence plan stage approved (2/3)
- convergence exec stage approved (2/3)
- no unresolved split
- advisor evidence present

## Commands

```bash
npm run build
node scripts/release-gate.mjs --plan <plan.json> --exec <exec.json> --require-convergence
```

Create tag and push:

```bash
git tag -a v0.1.0 -m "Salacia v0.1.0"
git push origin v0.1.0
```
