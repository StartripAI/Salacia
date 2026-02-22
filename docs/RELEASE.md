# Release Procedure

## Stable v0.1.2 Flow

1. Create/update integration branch `codex/salacia-v0.1-final`.
2. Pass CI matrix (`ubuntu/macos/windows` x `node 20/22/24`).
3. Run release gate with convergence evidence.
4. Merge to `main` via PR.
5. Ensure prompt metamorphic gate is green.
6. Tag `v0.1.2`.
7. Publish GitHub Release with changelog and evidence links.

## Mandatory Gate Conditions

- lint/test/build/smoke green
- secret scan green
- convergence plan stage approved (2/3)
- convergence exec stage approved (2/3)
- prompt metamorphic checks passed
- superiority audit stronger-than-baseline passed
- no unresolved split
- advisor evidence present
- GitHub release workflows use mock advisors only and do not inject external API keys

## Commands

```bash
npm run build
node scripts/release-gate.mjs --plan <plan.json> --exec <exec.json> --require-convergence
```

Create tag and push:

```bash
git tag -a v0.1.2 -m "Salacia v0.1.2"
git push origin v0.1.2
```
