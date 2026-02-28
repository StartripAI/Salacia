# Trellis Capability Spec v1 (Clean-Room Target)

This spec captures black-box capabilities used for parity/win/lagging decisions.
It intentionally does not include Trellis source code.

## Capability Items

1. Prompt-to-spec lifecycle injection
- Input: natural-language requirement bundle
- Output: normalized project contract/spec with guardrails
- Failure mode: ambiguous requirement remains unresolved

2. Journaling and checkpoint continuity
- Input: multi-step task execution sequence
- Output: resumable artifact history with checkpoints and evidence links
- Failure mode: checkpoint missing or non-auditable transition

3. Long-task context governance
- Input: long-running execution with incremental updates
- Output: stable progress state, rollback anchors, and verification evidence
- Failure mode: drift across sessions or silent regressions

4. Convergence and verification gate behavior
- Input: advisor opinions + execution evidence
- Output: release-safe decision with explicit split handling
- Failure mode: non-majority accepted as pass

5. Protected path safety and regression blocking
- Input: high-risk task touching protected areas
- Output: blocked action + rollback recommendation + evidence trail
- Failure mode: protected path mutation without guard

Each item is mapped to automated probes in
`src/benchmark/runner.ts`.
