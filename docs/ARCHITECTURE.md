# Salacia Architecture

## Core Model

Salacia v0.2 is a harness/runtime for AI coding agents. The primary execution model is:

```text
program.md -> blueprint -> context pack -> run session -> verification -> judge -> promotion
```

## Four Planes

### 1. Control Plane

Primary artifact:

- `program.md`

Compiled output:

- `.salacia/blueprint.json`

Responsibilities:

- capture intent
- define mutable/protected surface
- define verification commands
- define budget and promotion policy

### 2. Context Plane

Primary artifact:

- `.salacia/context/<run-id>.json`

Responsibilities:

- build ranked repo map
- build working set/snippets
- summarize recent run history
- attach explicit guardrails

The context plane is budgeted. It does not attempt to stream the entire repository into the agent.

### 3. Harness Plane

Primary artifacts:

- `.salacia/runs/<run-id>/events.ndjson`
- `.salacia/runs/<run-id>/summary.json`
- `.salacia/runs/<run-id>/judge.json`
- `.salacia/runs/<run-id>/candidate.patch`

Responsibilities:

- prepare isolated workspace
- dispatch agent
- collect patch
- run verification
- produce `accept | reject | blocked`
- promote or revert

### 4. Eval Plane

Responsibilities:

- benchmark runs
- superiority profiles
- release gate consumption
- common evidence model

The eval plane reuses runtime evidence rather than inventing a separate reporting universe.

## Run Lifecycle

Every `salacia run` follows the same phases:

1. `compile_program`
2. `build_context`
3. `prepare_workspace`
4. `dispatch_agent`
5. `collect_patch`
6. `run_verification`
7. `run_judge`
8. `promote_or_revert`
9. `finalize_session`

## Judge Semantics

Judge results are fixed:

- `accept`
- `reject`
- `blocked`

Rules:

- `accept`: verification passed and writes stayed within mutable surface
- `reject`: verification or execution failed
- `blocked`: protected paths or out-of-scope writes were touched, or promotion could not be safely applied

## Why This Shape

This architecture deliberately separates:

- the human control artifact (`program.md`)
- the agent input (`ContextPack`)
- the execution trace (`RunSession`)
- the decision artifact (`JudgeReport`)

That separation makes Salacia suitable for both day-to-day coding runs and evidence-backed eval/release workflows.
