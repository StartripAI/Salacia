# Salacia v1.0 Benchmark Results

## Locked Evidence Runs (Latest)

- Core suite run id: `1771806923175-exaiqg`
- Full suite run id: `1771807660666-3uuak0`
- Commit: `a950f72f5d624c58f20ef9d4c60061d8d97ceab3`
- Generated on: `2026-02-23`

## Full Suite Summary (Current)

- Run ID: `1771807660666-3uuak0`
- Overall score: `9.4865`
- Scale probe: `actualFiles=100000`, `concurrency=32`, `hashErrors=0`
- Quality floor failures: `none`

## Strict SOTA Decision (Measured-Only)

- Command: `salacia benchmark sota-check --run 1771807660666-3uuak0 --json`
- Status: `fail`
- Win rate: `0.75`
- 95% bootstrap CI: `[0.25, 1.00]`
- Blocking reasons:
  - `unmeasured competitors present: cline, claude-code`

This is an intentional hard-fail policy: environment/auth/timeout failures are marked as `unavailable` (not force-scored as low capability), and strict mode blocks release claims until measured evidence is complete.

## Measured Competitor Evidence (Execution Governance)

- `aider`: `.salacia/journal/bench/competitor-runs/1771763157182-nsavwg/report.json`
- `codex`: `.salacia/journal/bench/competitor-runs/1771763157182-nsavwg/report.json`
- `continue`: `.salacia/journal/bench/competitor-runs/1771763471421-26ry4w/report.json`
- `opencode`: `.salacia/journal/bench/competitor-runs/1771806343375-joxzs0/report.json`
- `trellis`: `.salacia/journal/bench/competitor-runs/1771805032479-gc5mtx/report.json`
- `cline`: `.salacia/journal/bench/competitor-runs/1771807634352-8uu5gt/report.json` (`401 User not found`, marked `unavailable`)
- `claude-code`: `.salacia/journal/bench/competitor-runs/1771807352468-nzusjh/report.json` (`command timed out`, marked `unavailable`)

## Attestation

- Verify command:
  - `salacia benchmark verify --run 1771807660666-3uuak0 --json`
- Expected result:
  - `manifestVerified=true`
  - `signatureVerified=true`
  - `attestationMethod=ed25519`

## Reproduce

```bash
salacia benchmark run --suite full --json
salacia benchmark verify --run <run-id> --json
salacia benchmark compare --run <run-id> --json
salacia benchmark sota-check --run <run-id> --json
salacia benchmark sota-check --run <run-id> --allow-profiled --json # internal-only
```

All raw artifacts are stored under `.salacia/journal/bench/runs/<run-id>/`.
