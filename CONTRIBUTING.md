# Contributing

Thanks for taking a look. This is a small, opinionated client; the most useful contributions are bug reports
with a reproducible user journey, protocol fixes with tests, and documentation corrections.

## Before you start

- Read [`AGENTS.md`](AGENTS.md) for the actual repository layout. The app is **not** using Expo Router; it is a
  state machine in `App.tsx`.
- Read [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) before changing protocol or gateway assumptions.
- For a security issue, follow [`SECURITY.md`](SECURITY.md) instead of opening a public issue.

## Development

Requires Node.js 22.13+ and npm.

```bash
npm ci
npm start              # Expo dev server
npm test               # protocol/unit tests (Jest)
npm run test:node      # setup-script tests
npm run typecheck
npm run lint
```

If you add or change a native module, use `npx expo install <package>` so the SDK-compatible version is
selected. Expo Go only includes its bundled native modules; native additions need a development build.

## What a good change looks like

- **Small and focused.** One behaviour per pull request. Avoid drive-by refactors mixed with a fix.
- **Tested at the right level.** Pure logic in `src/protocol/` gets a unit test. UI or connection changes need a
  real-device or fake-gateway journey; say what you ran and what you saw.
- **No new state without a reason.** Reuse the existing state machine, storage helpers, and transport
  abstractions before adding a flag or a branch.
- **No secrets in the repository.** Never commit pairing payloads, tokens, keys, `credentials.json`, `keys/`,
  or screenshots with hostnames or account IDs.
- **Keep documentation languages consistent and preserve accessibility.** Update the Chinese and English README
  together and label icon-only controls. App-wide localization and the iOS release are deferred for this milestone.

## Commit and pull request

Use a short imperative commit message. In the pull request, include:

1. the user-visible problem;
2. the approach and the main files;
3. the commands you ran (`npm test`, `npm run typecheck`, `npm run lint`, node tests);
4. the real-device path you walked, if the change affects UI or connection behaviour;
5. known limitations or follow-ups.

By contributing, you agree that your contribution is licensed under the MIT License. The pet assets are
**not** MIT; do not add assets that cannot be redistributed under this repository's terms.
