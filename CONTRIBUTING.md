# Contributing

## Development Setup

```bash
npm install
npm run lint
npm test
npm run build
npm run smoke
```

## Branching

- Use feature branches from `main`.
- Open PRs with focused commit slices by subsystem.
- Keep changes auditable and reversible.

## Quality Gates

Required before merge:

1. `npm run lint`
2. `npm test`
3. `npm run build`
4. `npm run smoke`
5. release-gate workflow success for release-bound changes

## Commit Guidelines

- Use clear, scoped commit messages.
- Include tests with behavior changes.
- Do not add plaintext credentials.

## Clean-Room Rule

Contributions must be original work or properly licensed materials.
Do not copy protected third-party code or private assets.
