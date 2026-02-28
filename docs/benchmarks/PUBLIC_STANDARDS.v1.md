# Public Benchmark Standards (v1)

This file defines public, widely cited benchmark suites used for external credibility.

## Primary Public Suites

1. SWE-bench / SWE-bench Verified / SWE-bench Pro
- Type: software engineering bug-fix benchmark
- Source: https://github.com/swe-bench/SWE-bench
- Role: primary external coding-agent benchmark

2. LiveCodeBench
- Type: contamination-resistant coding benchmark
- Source: https://github.com/LiveCodeBench/LiveCodeBench
- Role: recency and leakage-robust coding quality signal

3. HumanEval+
- Type: code generation correctness benchmark
- Source: https://github.com/openai/human-eval
- Role: standardized pass@k baseline signal

## Salacia Suite IDs

- `swebench_lite_smoke` (SWE-bench Lite harness smoke)
- `swebench_verified_smoke` (SWE-bench Verified harness smoke)
- `swebench_verified_real_single` (SWE-bench Verified real single-instance patch+evaluation)
- `swebench_verified_real_single/<group>/<run-id>` (paired campaign layout for `group=scaffold|bare`)
- `swebench_pro_smoke` (SWE-bench Pro harness smoke)
- `swebench_pro_real_single` (SWE-bench Pro real single-instance patch+evaluation)
- `swebench_pro_real_single/<group>/<run-id>` (paired campaign layout for `group=scaffold|bare`)
- `aider_leaderboard_smoke` (Aider-style editing smoke proxy)
- `livecodebench_probe` (availability probe)
- `bigcodebench_probe` (availability probe)
- `swe_rebench_probe` (dataset connector probe)
- `humaneval_plus_probe` (availability probe)

Notes:
- `*_smoke` suites verify runnable pipeline and evidence quality.
- `*_real_single` suites execute a model-generated patch on one real benchmark instance with official harness evaluation.
- `*_probe` suites are explicit blocked/pass capability probes, not score claims.
- Smoke/probe outputs are auditable but are not official leaderboard submissions.

## 100 Paired Campaign Policy

- Sampling: `scripts/swebench-sample.py --count 100 --seed 42`
- Groups: `scaffold` (Salacia scaffold enabled) vs `bare` (`--no-scaffold`)
- Same-model rule: `scaffold` and `bare` must use the same backend/model family (ablation fairness).
- Recommended chain for ablation: use weaker same-family baselines (`gpt-5.1-codex,gpt-5-codex`) before top-end models.
- Orchestration: `salacia benchmark public-campaign --group both --public-suite swebench_verified_real_single|swebench_pro_real_single`
- Retry policy: run with `--public-local-retry-max 3` to expose guardian retry behavior.
- Statistics: `scripts/swebench-analyze.mjs` outputs pass-rate delta, McNemar, and `Pass@1/2/3`.
- Claim rule: public “scaffold gain” claim only when paired sample is sufficiently complete, McNemar `p < 0.05`, and scaffold retry gain (`Pass@3 - Pass@1`) is non-negative.

## Policy

- Public suite results must be stored under:
  - `.salacia/journal/bench/public/<suite>/<run-id>/`
- Each run must include:
  - runner command
  - raw output
  - parsed metrics
  - environment metadata
  - artifact hash manifest

## Claim Levels

- Internal claim: Salacia custom probes only (allowed for engineering iteration).
- External claim: requires public suite evidence (SWE-bench/LiveCodeBench/HumanEval+).
- Strict SOTA claim: `salacia benchmark sota-check` (default measured-only behavior).
- Internal-only fallback: `salacia benchmark sota-check --allow-profiled`.

Public audit modes:
- `release`: minimal smoke gate (`swebench_lite_smoke`)
- `community`: stronger public track (`swebench_verified_smoke`, `swebench_pro_smoke`, `bigcodebench_probe`)
- `full`: all known public suite ids (including probes)
