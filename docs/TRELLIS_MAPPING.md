# Trellis Capability Mapping (Clean-Room)

## Purpose
This document maps Trellis-like capability patterns into Salacia v0.1.1 without copying protected source code.

## Mapping Table

| Trellis-style capability pattern | Salacia v0.1.1 implementation |
| --- | --- |
| Prompt normalization and intent lifting | `src/prompt/compile.ts` -> `IntentIR` compiler pipeline |
| Long-task continuity and checkpoint memory | `src/guardian/progress.ts` + `src/guardian/consistency.ts` |
| Journaling and resumable evidence | `.salacia/journal/*` + prompt patch artifacts |
| Single high-value clarification question | `src/prompt/disambiguate.ts` |
| Drift and rollback guardrails | `src/guardian/drift.ts`, `src/guardian/snapshot.ts`, `src/guardian/rollback.ts` |
| Capability bridge across executors and IDEs | unified `UnifiedBridgeAdapter` model + adapter registry |

## Design Deltas
1. Salacia uses explicit Contract/Spec/Plan artifacts as primary source of truth.
2. Salacia enforces dual convergence gates (`plan` and `exec`) for release blocking.
3. Salacia keeps adapter behavior machine-readable with deterministic JSON output paths.

## Evidence Paths
- Prompt compiler output: `.salacia/plans/intent-ir-*.json`
- Prompt patch evidence: `.salacia/journal/prompt-patches/*.json`
- Consistency evidence: `.salacia/progress/feature-fingerprint.json`
