# Building and releasing

Muse Desktop is an **unofficial** project maintained by Robert Courson. Keep the affiliation notice in app metadata, release notes, and redistribution notices.

## Local builds

Use macOS 13+, Node.js 22.12+, and Xcode Command Line Tools:

```sh
npm ci
npm run package:unsigned
npm run dist:unsigned
```

The packaging hook downloads Sparkle 2.10.0 from its official release, verifies the pinned SHA-256 checksum, compiles the Node-API bridge, and embeds the framework before code signing. Downloaded tools stay in ignored `.cache/sparkle/`. No key is required to build the app: its public verification key is source controlled.

Local unsigned builds and CI artifacts are for development. Do not remove quarantine as a substitute for signing and notarization.

## Signing and notarization on a maintainer's Mac

Use a **Developer ID Application** certificate. This project's maintainer signs as Robert Courson, team `9F2JXY8TCK`. No certificate or private signing key is included in the repository.

Create an Apple app-specific password in your [Apple Account](https://account.apple.com/) under **Sign-In and Security → App-Specific Passwords**. Do not use your normal account password. Store the credentials interactively; the password prompt is hidden:

```sh
xcrun notarytool store-credentials muse-desktop --team-id 9F2JXY8TCK
```

The profile is stored in your local Keychain. Alternatively, use `notarytool store-credentials` with an App Store Connect API key. Apple documents both methods in [Customizing the notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow).

With the certificate in Keychain and the profile configured:

```sh
APPLE_KEYCHAIN_PROFILE=muse-desktop npm run dist -- --config.forceCodeSigning=true
```

This builds signed, notarized apps for Apple Silicon and Intel, packages them as DMGs and ZIPs, then signs, notarizes, and staples the DMG containers as well. To build a signed candidate before notarization is configured:

```sh
npm run build
npx electron-builder --mac --dir --arm64 -c.mac.notarize=false -c.forceCodeSigning=true
```

A signature alone does not establish a seamless downloaded first launch. Verify the final app with `codesign --verify --deep --strict`, `spctl --assess --type execute`, and `xcrun stapler validate`.

## Sparkle

- `scripts/sparkle-config.json` pins the framework, public Ed25519 key, keychain account, and GitHub repository.
- The private key is stored under the Keychain account **muse-desktop-robzilla1738**. Back it up securely; losing it can prevent updates to installed apps. Never commit or print it.
- `updates/appcast-arm64.xml` and `updates/appcast-x64.xml` are signed feeds served from this repository's `main` branch. They initially contain no releases. Do not edit a signed XML feed by hand or run a formatter over it.
- Both feed and archive verification are required by the embedded app configuration. Native update UI is available from the app menu and **Settings → About**. Daily checks are opt-in; automatic installation and system profiling are disabled.
- The updater rejects relaunch during active CLI turns. Save any unsent draft and finish voice input before installing. Quit handling closes the CLI and cancels transcription.

After building notarized archives, generate new signed feeds:

```sh
npm run release:appcast
```

This uses Sparkle's official `generate_appcast` and `sign_update` tools with your Keychain key. On CI, it accepts the same key through the `SPARKLE_PRIVATE_KEY` secret via standard input. It extracts and verifies each actual ZIP's app signature, notarization ticket, Gatekeeper acceptance, architecture, version, and embedded public key before signing anything. Generated feeds go to `release/appcasts/`; the live feeds remain unchanged until publication. Both architectures are required for the stable feed.

Publish the matching `v<version>` GitHub Release assets first, then copy `release/appcasts/*.xml` into `updates/` and commit. Never publish a feed before its downloads exist. If feed publication fails after a release is uploaded, recover the signed feeds from the workflow artifact and commit them; do not replace an existing release with different binaries of the same version.

## GitHub release workflow

The manually dispatched **Publish signed macOS release** workflow runs only from `main` when initiated by the repository owner. It requires the `release` environment and these secrets:

| Secret                        | Purpose                                                      |
| ----------------------------- | ------------------------------------------------------------ |
| `CSC_LINK`                    | Base64-encoded Developer ID certificate archive              |
| `CSC_KEY_PASSWORD`            | Certificate archive password                                 |
| `APPLE_ID`                    | Developer Apple Account email                                |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific notarization password                           |
| `APPLE_TEAM_ID`               | Apple developer team                                         |
| `SPARKLE_PRIVATE_KEY`         | Sparkle Ed25519 seed exported from the maintainer's Keychain |

The workflow checks formatting, unit tests, compilation, setup/restart behavior, signing, and notarization. It creates a draft release with both architecture downloads and checksums, publishes it, then commits the signed feeds using Robert's GitHub identity. Missing credentials or failed verification stop publication. The `SPARKLE_PRIVATE_KEY` environment secret is configured. Apple signing and notarization secrets still need to be supplied for GitHub-hosted releases; the local Keychain profile already supports releases from the maintainer’s Mac.

Before running it:

1. Bump the version in `package.json` and `package-lock.json`. Never reuse a published version.
2. Run `npm run test:integration` and `npm run test:e2e` locally against the supported Muse CLI. Public CI does not receive Muse download/account credentials.
3. Test physical microphone capture, a real model turn with approval, cancellation, existing sessions, restart, and a downloaded quarantined build. Test Intel and the oldest supported macOS on appropriate hardware.
4. Review [NOTICE](../NOTICE.md) for trademark and artwork rights. “Unofficial” is an affiliation disclaimer, not a grant of rights.
5. Run the release workflow, review its output, and verify both download links and Sparkle checks on an installed app.

CI development archives use `ditto` to preserve executable permissions. The `global-agent` override upgrades electron-builder's downloader dependency to remove a vulnerable logging dependency; re-evaluate it when upgrading the packager.

Forks must replace the app identifier, update key, feed repository, code-signing identity, and maintainer metadata before distributing their own app. Keep third-party notices.
