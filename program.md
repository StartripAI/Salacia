# Salacia Program

## Goal
- Evolve Salacia into a repository-aware harness/runtime for AI coding agents.

## Constraints
- Keep the public surface auditable and implementation choices reversible.
- Favor deterministic artifacts over opaque agent-side state.
- Preserve adapter neutrality across Claude Code, Codex, OpenCode, and IDE bridges.

## Mutable Surface
- src/**
- tests/**
- docs/**
- scripts/**
- README.md
- package.json

## Protected Surface
- .salacia/**
- node_modules/**
- dist/**
- third_party/**
- .env*
- secrets/**

## Success Metrics
- `design -> run -> judge -> trace -> eval` is a coherent public flow.
- Context building is budgeted and evidence-backed.
- Judge results are reusable by release gates and eval.

## Budget
- maxFiles: 8
- maxSymbols: 20
- maxSnippetChars: 12000
- maxHistoryEntries: 5

## Verification
- npm run lint
- npm test
- npm run build

## Promotion Policy
- Accept only when verification passes and writes stay inside the mutable surface.
- Reject when verification fails.
- Block when protected paths or out-of-scope writes are detected.
