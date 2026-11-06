# Contributing

Thanks for taking a look. This is a small, opinionated client; the most useful contributions are bug reports
with a reproducible user journey, protocol fixes with tests, and documentation corrections.

## Before you start

- Read [`AGENTS.md`](AGENTS.md) for the actual repository layout and engineering invariants. The app is
  **not** using Expo Router; it is a state machine in `App.tsx`.
- Read [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) and [`compatibility.json`](compatibility.json) before
  changing protocol or gateway assumptions. Use the pinned versions; do not default to `@latest`.
- Read [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for local checks and reproducible test journeys,
  and [`docs/DESIGN.md`](docs/DESIGN.md) for interaction principles.
- For a security issue, follow [`SECURITY.md`](SECURITY.md) instead of opening a public issue.

## Development

Requires Node.js 22.13+ and npm.

```bash
npm ci
npm start              # Expo dev server
npm test               # protocol/unit tests (Jest)
npm run test:node      # setup-script tests
npm run test:all       # Jest + node tests
npm run typecheck
npm run lint
npx expo-doctor        # after dependency or app-config changes
```

If you add or change a native module, use `npx expo install <package>` so the SDK-compatible version is
selected. Expo Go only includes its bundled native modules; native additions need a development build.

## What a good change looks like

- **Small and focused.** One behaviour per pull request. Avoid drive-by refactors mixed with a fix.
- **Tested at the right level.** Pure logic in `src/protocol/` gets a unit test. UI or connection changes need a
  real-device or fake-gateway journey; say what you ran and what you saw. Grade the result as **source/test
  confirmed**, **real-device observed**, or **still a hypothesis**; do not promote one into another.
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
3. the commands you ran (`npm test`, `npm run test:node`, `npm run typecheck`, `npm run lint`, and
   `npx expo-doctor` when relevant);
4. the real-device or fake-gateway path you walked, if the change affects UI or connection behaviour, with the
   evidence level stated honestly;
5. known limitations or follow-ups, and relevant updates to current documentation.

By contributing, you agree that your contribution is licensed under the MIT License. The pet assets are
**not** MIT; do not add assets that cannot be redistributed under this repository's terms.
