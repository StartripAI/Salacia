# Clean-Room Reuse Policy

## Scope
Salacia reuses public ideas and capability patterns only. Protected source code and proprietary assets are not copied.

## Rules
1. No direct code transfer from third-party repositories.
2. Every absorbed capability must include:
- source pattern summary,
- independent Salacia design,
- implementation evidence paths.
3. Pull requests must include a clean-room declaration checkbox.
4. If provenance is uncertain, feature must be re-designed from first principles.

## Proof Checklist (per capability)
- Pattern statement documented.
- Salacia architecture fit documented.
- New code authored inside this repository only.
- Evidence files generated in `.salacia/journal` during tests.

## v0.1.1 Applied Areas
- Prompt Compiler
- Active Disambiguation
- Metamorphic Prompt Testing
- Prompt Optimizer
- Consistency Safety Net
