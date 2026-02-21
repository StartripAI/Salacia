# Changelog

## 0.1.2 - 2026-02-21

- Hotfix: normalize restored snapshot line ending assertion for Windows CI.
- Confirmed `main` cross-platform matrix green after v0.1.1 merge.

## 0.1.1 - 2026-02-21

- Added Prompt Compiler pipeline (`IntentIR`, diagnostics, auto-correct) and wired it into `salacia plan`.
- Added high-risk single-question Active Disambiguation with non-interactive machine-readable fail behavior.
- Added Metamorphic Prompt Testing and integrated pass checks into release gate.
- Added Prompt Optimizer with auditable/rollback-able prompt patches from `.salacia/journal` evidence.
- Added Consistency Safety Net (feature fingerprint, revert/ghost/drift detection, auto snapshot block).
- Added `salacia prompt compile|test|optimize` and `salacia guard consistency`.
- Added clean-room capability absorption docs and PR template enforcement checklist.
- Added dedicated snapshot restore success/failure unit coverage.

## 0.1.0 - 2026-02-21

- Finalized Salacia v0.1 CLI command surface.
- Implemented unified bridge model across all target adapters.
- Added convergence gating in both plan and execution stages.
- Hardened guardian capabilities: drift, snapshot checksum, rollback, verification evidence.
- Implemented MCP gateway/server and ACP dispatch bridges.
- Added cross-platform CI matrix and release-gate workflow.
- Added production governance and security documentation.
