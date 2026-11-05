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
