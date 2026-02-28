# License Compatibility

This document defines Salacia v1.0 license compatibility boundaries.

## Project License

- Salacia core: Apache-2.0

## Compatible Reuse Modes

1. Apache-2.0 / MIT / BSD:
   - Allowed via mirror + wrapper.
   - Must preserve copyright notices and license text.
2. AGPL:
   - Not allowed for direct source mirroring in Salacia core.
   - Use clean-room capability alignment only.
3. Closed source:
   - No source reuse.
   - Black-box behavior benchmarking only.

## Current Mirror Set

- aider (Apache-2.0)
- cline (Apache-2.0)
- continue (Apache-2.0)

Pinned commits are recorded in `third_party/MANIFEST.json`.
