# Trellis Clean-Room Trace v1

This trace documents capability alignment without source copying.

## Process

1. Read public documentation, demos, and behavior descriptions.
2. Write Salacia-native design in TypeScript with independent data models.
3. Bind each capability to one or more benchmark probes.
4. Capture evidence under `.salacia/journal/bench/runs/<run-id>/`.
5. Record parity/win/lagging from benchmark outputs only.

## Capability-to-Implementation Mapping

| Capability | Salacia Implementation | Probe IDs |
| --- | --- | --- |
| Lifecycle injection | `src/prompt/compile.ts`, `src/core/contract.ts` | `prompt.*`, `contract.*` |
| Journaling/checkpoint | `src/guardian/snapshot.ts`, `src/guardian/progress.ts` | `governance.snapshot-rollback` |
| Long-task governance | `src/harness/incremental.ts`, `src/guardian/consistency.ts` | `governance.consistency-block` |
| Convergence gates | `src/core/converge.ts`, `src/cli/index.ts` | `convergence.*` |
| Protected path safety | `src/harness/hooks.ts`, `src/guardian/drift.ts` | `prompt.disambiguation-gate`, `governance.consistency-block` |

## Compliance Assertions

- No Trellis source files are present in `src/`.
- Trellis is not listed in `third_party/MANIFEST.json`.
- Salacia benchmark evidence remains auditable and reproducible from source.
