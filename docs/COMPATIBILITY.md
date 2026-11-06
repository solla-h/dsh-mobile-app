# Compatibility and version lock

The app speaks `dsh-mobile-v1`, but the protocol, the gateway plugin and DSH itself change independently.
A gateway that works with one app build can be incompatible with another. This file is the release-level
source of truth for the combination we actually tested.

The machine-readable copy is [`compatibility.json`](../compatibility.json). Update both together.

[`v0.1.0-alpha.4`](https://github.com/solla-h/dsh-mobile-app/releases/tag/v0.1.0-alpha.4) provides a GitHub Actions APK
with Android version code 4 and the same app/protocol version. Its signed APK passed the complete local-fixture
Android emulator journey; independently downloaded checksums, cryptographic signature, package identity and
private-network Manifest policy were verified on 2026-11-07. Its source commit and signing certificate are in
`build-info.json`. See [release validation status](OPEN-SOURCE-READINESS.md) for the run and limits.
The real-device entry below describes the earlier EAS preview; it does not claim that this APK has been tested
on a phone. Physical installation/upgrade, voice, camera, accessibility and real-network journeys remain pending.

## Maintained gateway source

Our maintained fork is [solla-h/dsh-plugin-mobile-gateway](https://github.com/solla-h/dsh-plugin-mobile-gateway),
based on [Clarklevis1995/dsh-plugin-mobile-gateway](https://github.com/Clarklevis1995/dsh-plugin-mobile-gateway).
The supported source is `github:solla-h/dsh-plugin-mobile-gateway#v0.12.0-rdv.3`. This is a GitHub-tagged
fork release, not an npm release with that version. The package name stays `dsh-plugin-mobile-gateway`;
the setup script chooses the pinned source. Do not install upstream and fork together.

Upstream updates are integrated through reviewed compatibility work. A shared protocol number does not
make a new DSH, Node or plugin release supported. See [gateway maintenance](GATEWAY-MAINTENANCE.md) for
synchronization, verification and release rules.

## Verified combination

| App | Build | Protocol | Gateway plugin | DSH | Platform | Verified |
| --- | --- | --- | --- | --- | --- | --- |
| 0.1.0 | `224d30c6` | `dsh-mobile-v1` / 3 | `0.12.0-rdv.3` (fork) | `0.2.1-rc.5` | Android | 2026-11-05 |

The fork release includes `rendezvous-v1` (the optional encrypted address book). The upstream plugin at the
time of writing is a different release line; it is not part of this verified combination.

**Recommended for new installs:** `0.12.0-rdv.3`. It adds endpoint-health auto-retry and clearer connection
notices; the protocol is unchanged. `compatibility.json` pins this version and the setup script installs it.
The table above records the real-device regression on rdv.3: pairing, session list, text reply, and
hold-to-talk voice.

Not covered by the verified entry:

- iOS;
- DSH versions other than `0.2.1-rc.5`;
- gateway versions other than the verified and recommended entries above;
- installing from a local `git clone` or a `link:` dependency.

“Not covered” means “stop and ask”, not “try it and see”.

Voice input is an **optional host add-on**, not part of the gateway protocol entry above. For DSH
`0.2.1-rc.5`, use the matching official bundle:

| Voice bundle | DSH | Notes |
| --- | --- | --- |
| `@deepseek-ai/dsh-experimental-voice-input-bundle@0.2.1-rc.5` | `0.2.1-rc.5` | Exact dependency match; no profile exemption needed. |

The older `0.1.7-alpha.1` line is disabled by DSH compatibility rules on `0.2.1-rc.5`; do not use it. The app
already supports voice; the host bundle and its model are what make the voice entry ready. The setup script
installs and pre-downloads it only after the user confirms.

## How the app checks at runtime

The gateway's `hello` frame includes:

- `protocol` — the `dsh-mobile-v1` protocol number (currently `3`);
- `dshVersion` — currently a **build-time constant in the gateway plugin**, not the running host's version
  (the current fork, including `0.12.0-rdv.3`, reports `0.2.1-rc.2`). The app therefore does **not** enforce `dshVersion`; doing so would
  produce false warnings on a verified host.

The app compares `protocol` with `compatibility.json` and shows a warning when it is outside the verified
protocol. It keeps the connection open so the user can still read or finish a task; it does not silently
pretend the combination is supported.

`hello` does not include the gateway plugin version, and its `dshVersion` is not yet trustworthy. That is why
the agent preflight below is required: the checker reads the installed plugin spec and runs `dsh --version`
on the actual host.

## Agent preflight

Do not run `dsh plugin add` directly. The setup surface is
[`scripts/setup-gateway.mjs`](../scripts/setup-gateway.mjs):

```bash
node scripts/setup-gateway.mjs check          # read-only; the agent may run this
node scripts/setup-gateway.mjs install --yes  # the user runs this with DSH Web stopped
```

The script uses exactly the pinned value below; never use `@latest`, a local checkout, a `link:` dependency, or
a profile backup. If the user's DSH is not `0.2.1-rc.5`, the script refuses to install; stop and ask; do not
auto-upgrade DSH.

```bash
dsh plugin --profile web add github:solla-h/dsh-plugin-mobile-gateway#v0.12.0-rdv.3
```

The underlying dependency-free checker is also available on its own:

```bash
# From a clone of this repository:
node scripts/check-compat.mjs --profile web

# Or download the manifest and checker to a temp directory (the setup script also needs
# scripts/setup-gateway.mjs; see AGENT-SETUP.md for the full three-file snippet):
tmp="$(mktemp -d)"
curl -fsSL https://raw.githubusercontent.com/solla-h/dsh-mobile-app/master/compatibility.json \
  -o "$tmp/compatibility.json"
curl -fsSL https://raw.githubusercontent.com/solla-h/dsh-mobile-app/master/scripts/check-compat.mjs \
  -o "$tmp/check-compat.mjs"
node "$tmp/check-compat.mjs" --manifest "$tmp/compatibility.json" --profile web --json
```

The checker reads the plugin spec from `~/.dsh/profiles/<profile>/package.json`, verifies the **installed**
package version under `node_modules`, runs `dsh --version`, and fails on a local path, an unverified plugin, an
unverified DSH version, or a protocol mismatch. It never prints pairing tokens or secrets.

## Release rule

When changing the recommended combination, update `compatibility.json` and this guide together:

1. identify the app version and candidate APK source/build;
2. record the exact gateway plugin version and immutable install source;
3. record the target DSH, protocol, platform and optional voice bundle;
4. run `node scripts/setup-gateway.mjs check` on the installed candidate, fully restart DSH Web, and run
   the actual app/host journey; test voice when it is part of the supported combination;
5. update `verified[]` and the real-device table only with actual device evidence for the tested build;
6. update Chinese/English README requirements and user guides together.

An APK rebuild does not transfer old device evidence to a new build. Record its automated build, signature
and emulator results in [release validation status](OPEN-SOURCE-READINESS.md), leaving earlier preview
records intact until new device testing exists. The checker validates declared source/version and installed
package version; it is not a cryptographic source check or proof of the running host's loaded code.

Do not ship a release whose docs say “install the latest gateway”. “Latest” is not a version.
