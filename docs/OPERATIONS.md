# Operations

## v0.2 Primary Flow

Initialize a repository:

```bash
salacia init
```

Compile `program.md` into a blueprint:

```bash
salacia design --json
```

Run the harness:

```bash
salacia run --adapter codex --json
```

Inspect the decision:

```bash
salacia judge --json
salacia trace --json
```

## Eval Surface

Run benchmark probes:

```bash
salacia eval run --suite full --json
```

Compare against competitors:

```bash
salacia eval compare --run <run-id> --json
```

Verify benchmark attestation:

```bash
salacia eval verify --run <run-id> --json
```

Run superiority profile:

```bash
salacia eval superiority --profile docs/benchmarks/trellis-baseline.v1.json --json
```

## Judge and Promotion

Judge output is always written to:

```text
.salacia/runs/<run-id>/judge.json
```

Possible outcomes:

- `accept`
- `reject`
- `blocked`

Promotion policy:

- accepted patches may be promoted to the root workspace
- rejected patches are discarded
- blocked runs preserve trace/evidence but do not promote changes

## Release Gate

Release policy should consume:

- runtime judge reports
- eval/superiority reports
- standard verification commands

This replaces the old v0.1 mental model of “convergence-only release gating.”

## Legacy v0.1 Surface

The following commands are legacy/transitional:

- `plan`
- `forge`
- `prompt`
- `execute`
- `validate`

They remain useful for compatibility and historical tests, but the primary runtime flow is now:

```text
init -> design -> run -> judge -> trace -> eval
```
