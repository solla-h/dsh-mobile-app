# Gateway maintenance and app compatibility

DSH Mobile uses the maintained fork [solla-h/dsh-plugin-mobile-gateway](https://github.com/solla-h/dsh-plugin-mobile-gateway)
of [Clarklevis1995/dsh-plugin-mobile-gateway](https://github.com/Clarklevis1995/dsh-plugin-mobile-gateway).
The fork remains MIT with the upstream copyright and license preserved. It includes the app's optional
encrypted address book and managed Worker support.

For installation, use the [user guide](USER-GUIDE.md) or [Agent setup guide](AGENT-SETUP.md).
This page is for contributors coordinating changes between the app and gateway repositories.

## One recommended installation source

[`compatibility.json`](../compatibility.json) owns the app's recommended combination: app version,
gateway package/version/source, DSH, protocol and optional voice bundle. The current source is an exact
GitHub tag in our fork. It is not the upstream npm release line and does not require cloning or building
the gateway. The setup script selects this source for the user.

Keep these identities separate:

| Identity | Contract |
| --- | --- |
| Source repository | Our maintained fork; upstream changes enter through reviewed PRs |
| Installable package | `dsh-plugin-mobile-gateway`, installed from the manifest's exact GitHub tag |
| DSH plugin | `mobile-gateway`; the maintained and upstream packages replace one another, not coexist |
| Gateway/device identities | Persisted pairing and address-book state; preserve them during upgrades |

Do not substitute `@latest`, a version range, another repository, a branch, a local checkout or an npm
alias merely because its package reports the same version. The installed package version must also match.
The installer check does not establish a cryptographic proof of source or prove what an already-running
process loaded; perform the full host restart and the actual connection checks.

## Working across the two repositories

App code, installation checks and the recommendation manifest live here. Gateway implementation,
package tests and upstream synchronization live in the fork. Read that repository's `AGENTS.md` and
[maintainer guide](https://github.com/solla-h/dsh-plugin-mobile-gateway/blob/main/docs/MAINTAINING.md)
before editing it. `CLAUDE.md` in each repository imports its own `AGENTS.md` to avoid a second rulebook.

1. Identify the user journey and the exact affected wire contract. Read the pinned gateway's
   `PROTOCOL.md` and implementation; record the candidate commit separately from the supported tag.
2. Review upstream releases and relevant security fixes regularly and before each gateway release.
   Make small, reviewable patches; offer generally useful fixes upstream and remove redundant patches
   after integration. Do not merge upstream directly into a supported release tag.
3. Treat a DSH or Node baseline change as a compatibility change. Equal `dsh-mobile-v1` protocol numbers
   do not prove that host interfaces, frames, voice or persisted state are compatible.
4. Test the candidate package and the app. Use a separate environment with the target DSH and voice
   versions; preserve a private backup of state before any upgrade probe. Never use a production
   installation as a disposable fixture.
5. Publish an immutable gateway release, then propose the app manifest and documentation update.
   Keep the old recommendation until the candidate has the required evidence. Never auto-upgrade the
   user's DSH to make a gateway install succeed.

## Verification and promotion

| Check | What it establishes |
| --- | --- |
| Gateway `npm test` and `npm run test:package` | Gateway regression and package-install behavior covered by those tests |
| App Jest, Node setup tests, typecheck and lint | App/protocol/setup behavior covered by the tests |
| App's fixture-backed Android journey | The compiled APK's native client path against synthetic gateway responses |
| Exact package + target DSH + actual app journey | Compatibility of the specific host/plugin/app combination exercised |
| Physical-device journey | Device-specific networking, permissions, microphone/camera, accessibility and gestures exercised |

The first three rows do not substitute for the last two. When adding a supported combination, record
which checks passed and which remain unverified; follow the evidence levels in [DEVELOPMENT.md](DEVELOPMENT.md).
Do not promote an earlier preview's device results to a new APK.

For a gateway upgrade, check fresh pairing **and** existing pairing/state retention, list/history,
streamed text, approvals, attachments and optional voice. Include failure, cancellation, leaving midway,
disconnect, background/foreground, gateway restart, return to the list and reopening the app. Address-book
changes also need endpoint migration and disable/re-enable checks. Verify rollback before claiming a
state-format migration is reversible; reinstalling an older package alone is not proof.

At promotion, update `compatibility.json`, [COMPATIBILITY.md](COMPATIBILITY.md), Chinese/English README
requirements and both user guides together. Keep `verified[]` as actual device evidence with its original
build identity; record APK automated verification in [release validation status](OPEN-SOURCE-READINESS.md).
The current gateway's handshake lacks its package version and reports a fixed DSH version; retain the
host preflight described in the compatibility guide instead of inventing a runtime guarantee.

## Public records and secrets

Release notes should identify source tag/commit, upstream baseline, supported DSH/Node combination,
checks run, migration steps and limitations. Preserve published tags and downloadable artifacts.
Do not publish pairing payloads, tokens, gateway/device/account identifiers, private host addresses,
state backups or raw user logs. Public examples and CI evidence use synthetic data.
