# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it leaves alpha.

## [Unreleased]

## [0.1.0-alpha.1] - 2026-11-05

### Added

- Initial public alpha of the DSH Mobile client.
- QR/payload pairing, multiple saved gateways, cached session lists, and reconnect/offline handling.
- Focus home, session list, live conversation, approvals/questions, tool trajectories, Markdown, attachments,
  files, voice input, plugin/schedule views, and the optional encrypted rendezvous address book.
- Setup and compatibility checker for `dsh-plugin-mobile-gateway`.

### Verified

- Android 16 real device with DSH `0.2.1-rc.5` and gateway `0.12.0-rdv.3`: pairing, session list, text reply,
  and hold-to-talk voice.

### Known limitations

- iOS is not yet verified.
- No app-store release; the alpha is source-only.
- The gateway and DSH versions outside the verified combination are unsupported; see
  [`compatibility.json`](compatibility.json).
- The animated pet assets are CC BY-NC-SA 4.0 and may not be used commercially.
