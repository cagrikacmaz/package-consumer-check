# Contributing

Thanks for considering a contribution to `package-consumer-check`.

## Development

Use Node.js 20 or newer and npm:

```bash
npm ci
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:coverage
npm run build
npm pack --dry-run
```

Integration tests pack local fixtures and install them in owned temporary projects. They do not
publish anything. Keep fixtures small, deterministic, cross-platform, and free of network-only
dependencies.

## Design expectations

- Preserve stable check identifiers and serializable public results.
- Keep package execution explicit; never describe this tool as a sandbox.
- Run subprocesses with `shell: false`, bounded output, and timeouts.
- Delete only resources created and marked by the current run.
- Add focused tests for behavior changes, especially Windows path and process behavior.
- Avoid adding remote targets, extra package managers, or configuration systems without prior design
  discussion.

## Pull requests

Explain the consumer failure mode being addressed and how it was reproduced. Keep commits honest and
focused. By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
