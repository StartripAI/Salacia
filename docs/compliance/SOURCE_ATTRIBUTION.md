# Source Attribution Policy

Salacia uses two source strategies:

1. Clean-room implementation for AGPL or closed-source projects (for example Trellis and Cursor).
2. Mirror + wrapper for approved permissive/open licenses where code reuse is allowed with attribution.

## Rules

- No third-party source code may be copied into `src/` directly.
- Mirrored third-party code must live only under `third_party/`.
- Every mirrored dependency must be declared in `third_party/MANIFEST.json`.
- Every mirrored dependency must preserve upstream `LICENSE` / `NOTICE` files.
- Every mirrored dependency must be listed in `THIRD_PARTY_NOTICES.md`.
- Wrapper integration code must live under `src/vendor_wrappers/` and stay auditable.

## Enforcement

- `scripts/license-audit.mjs` checks license documents and notices.
- `scripts/vendor-integrity-audit.mjs` checks mirror integrity and commit pinning.
- Release gate fails if either audit fails.
