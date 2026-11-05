# Security policy

## Supported versions

The public alpha is `0.1.x`. Security fixes land on `master` and are called out in the release notes; older
alpha builds are not supported.

## Reporting a vulnerability

Please **do not** open a public issue with exploit details, pairing payloads, device tokens, gateway write
secrets, private keys, or screenshots that contain hostnames or account IDs.

Use GitHub's private vulnerability reporting:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Include the affected version, platform, steps to reproduce, and the impact.

If private reporting is unavailable, open a minimal issue asking for a private channel and leave the sensitive
details out.

## Scope notes

- Pairing payloads, device tokens, and the optional rendezvous key are credentials. Treat them like passwords.
- The mobile gateway is a separate project; report gateway or host vulnerabilities there or to the host owner.
- The app is a client. A compromised DSH host or gateway can read everything the app sends to it; the app does
  not claim to protect data from the host.

## Dependency advisories

This repository ships a React Native app, not a Node.js server. `npm audit` and Dependabot can report
advisories in the **development toolchain** (Jest, ESLint, Expo CLI). Those packages are used to lint, test, and
bundle the app; they are not included in the built app, and the vulnerable code paths (for example, the `glob`
CLI `-c/--cmd` option or merging untrusted Jest config) are not reachable from application input.

We still track them. Major-version overrides are not applied blindly because the Expo SDK and Jest toolchain
pin compatible versions; an override can break the build while not reducing application risk. When a compatible
upstream release is available, the dependency update is picked up through Dependabot.
