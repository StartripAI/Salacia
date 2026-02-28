# Salacia Benchmark Charter v1

## Purpose
This charter defines the non-negotiable benchmark protocol for Salacia v1.0 SOTA claims.

## Core Principles
1. Reproducible: every run must be replayable from run config + dataset hash.
2. Verifiable: every run emits signed attestation and hash manifest.
3. Comparable: every scored dimension must map to the competitor matrix.
4. Actionable: failing probes must point to concrete evidence and owners.
5. Anti-gaming: shuffled order, hidden probes, and repeat consistency checks.
6. Public-first: public benchmark suites are primary for external claims; Salacia custom probes are secondary for product-specific guarantees.

## Fixed Suites
1. `core`: correctness and safety baseline.
2. `scale`: real large-repo execution (`100k files` fixture scan/hash, `32 concurrency`, `24h soak` target policy).
3. `full`: `core + scale + hidden probes`.

## Probe Metrics
Each probe emits:
1. `functional_pass` (`0|1`)
2. `quality_score` (`0-10`)
3. `reliability_score` (`0-10`)
4. `dimension_score = functional_pass ? 0.5*quality + 0.5*reliability : 0`
5. `evidence_refs[]`

## SOTA Decision Rule
A run is SOTA-pass only if all conditions hold:
1. Global win-rate against competitor matrix is `>= 0.70`.
2. Each key dimension has `quality_score >= 8.0`.
3. No P0 blocker in compliance, stability, or recoverability.
4. Strict mode compares only method-aligned pairs: `external-competitor-run` vs `measured`.
5. Any row with `unavailable` provenance or `null` score is `excluded` and cannot enter scoring.
6. Method-mismatch rows are retained for audit (`methodMismatch=true`) but excluded from strict scoring.

External-claim mode is the default for `benchmark sota-check` and adds:
7. Every required competitor baseline in the comparison set must expose at least one strict-comparable measured row with evidence references.
Internal-only mode must be explicitly requested with `--allow-profiled`.

## Statistical Rule
1. Every probe must run at least `3` repeats.
2. Probe score aggregation uses median values.
3. Win-rate confidence interval is computed via bootstrap (`95% CI`).
4. If CI overlap is significant, classify as `parity`, not `win`.
5. `parity` is neutral and excluded from the win-rate denominator (only decisive `win/loss` pairs count).
6. `excluded` rows are always audited but never counted in win/loss denominators.

## Invalid Run Conditions
A run is invalid if any condition is true:
1. Missing `git commit`, runtime metadata, or dataset hash.
2. Missing `manifest.sha256` or `attestation` file.
3. Hash mismatch or signature verification failure.
4. Probe JSON violates schema.
5. Hidden probe execution policy is bypassed.
