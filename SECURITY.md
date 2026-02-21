# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| 0.1.x | yes |
| < 0.1.0 | no |

## Reporting a Vulnerability

1. Do not open public issues for exploitable findings.
2. Email the maintainers with:
   - impact summary
   - reproduction steps
   - affected files/commands
3. Maintainers acknowledge within 72 hours and provide a mitigation timeline.

## Incident Response

1. Triage and reproduce.
2. Contain impact (disable affected path or gate release).
3. Patch and add regression tests.
4. Rotate any potentially exposed credentials.
5. Publish a security note in release notes.

## Secret Handling

- Secrets must never be committed to git.
- Secrets must never be hardcoded in scripts or templates.
- Runtime credentials are injected via environment variables only.
- CI and release gate include secret scanning.

## Key Rotation

If a token is exposed:

1. Revoke immediately at provider side.
2. Generate replacement token.
3. Update CI/runtime secret stores.
4. Re-run release gate before any release action.
