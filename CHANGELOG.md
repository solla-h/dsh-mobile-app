# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it leaves alpha.

## [Unreleased]

### Added

- Real-App integration journeys for pairing, send/receive/return, cached offline launch and draft retention.
- Android emulator/Maestro journey checks for pull requests and signed release APKs before publication.
- Contrast regression checks and accessible names, states and actions across the primary navigation flow.

### Fixed

- Enable Android release-build networking for private LAN/Tailscale/USB `ws://` gateways. Public cleartext pairing URLs remain rejected by the client.
- Keep dial preview and gesture focus synchronized after accessibility adjustments, including a cancelled preview followed by an adjustment at the list edge.

### Changed

- Extract pairing, session-list and rename views from the main app coordinator while preserving state ownership.
- Improve muted-text and live-camera overlay contrast; expose session menus and dial navigation to accessibility actions.
- Make the project homepage Chinese-first with an English link, and keep current contributor/design/validation documentation.
- Remove obsolete discussion records, prompts and UI prototypes from the current documentation tree.
- Move website development to the independent `solla-h/dsh-mobile-site` repository.
- Increase Android version code to 4 for the next APK. Physical-device upgrade, voice, TalkBack and large-text checks remain pending.

## [0.1.0-alpha.3] - 2026-11-06

### Fixed

- Recognize build-tools 37 certificate output (`V2 Signer:` / `V3.0 Signer:`). The old parser read an empty
  fingerprint and blocked publication even though the APK was correctly signed. All reported certificate
  fingerprints must still match the pinned release identity; mismatched or missing certificates fail closed.
- Add signing-script regression checks to CI for old/new output, repeated certificates and rejection cases.

### Changed

- Android version code increases to 3. The failed alpha.2 tag is preserved; no alpha.2 APK was published.
- Real-device verification of this new APK remains pending; prior preview evidence is unchanged.

## [0.1.0-alpha.2] - 2026-11-06

The native build succeeded, but certificate-output parsing blocked publication. This tag has no released APK.

### Added

- Signed Android APK releases built by GitHub Actions, with SHA-256 checksums and source/build metadata.
- Tag validation and reusable quality checks before building; signature, package and version checks before
  publishing. Release assets are uploaded to a draft and verified before publication.
- Release runbook covering signing credentials, upgrades and failed builds.

### Changed

- Android version code increases from 1 to 2. The signing certificate is retained from the prior preview APK.
- Builds run on standard GitHub Ubuntu runners using Expo prebuild and Gradle, without EAS cloud quota or an
  Expo access token. Existing EAS profiles remain available for personal previews.

### Verification scope

- APK signature and metadata verification are automated. Real-device pairing/voice evidence still refers to
  the earlier preview build; this new APK needs its own installation and user-journey verification.

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
