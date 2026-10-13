# Release readiness — 0.1.0

Audit date: October 12, 2026. Target: macOS 13+, Apple Silicon and Intel. Development verification used Apple Silicon with Muse Code 1.4.7 and SDK 1.4.7.

This is a release candidate. Passing automated checks is not a guarantee of zero bugs or a substitute for notarization and testing on supported hardware.

The Apple Silicon app and DMG were rebuilt with a Developer ID Application signature. `codesign --verify --deep --strict` and the DMG checksum verification passed. The standalone app was launched and its real effort control verified against the Plush theme; changing effort preserved the theme. Notarization is deferred until the maintainer configures it. `release/SHA256SUMS.txt` records the current DMG checksum.

## Fixed during the audit

- Partial preference updates were applying defaults to omitted values. Changing thinking level could reset the theme, background intensity, CLI path, pins, and archives. Updates now use a separate schema without defaults; only native project selection can add project access or trust.
- The large mascot squeezed history into a clipped strip. Existing conversations now get a compact companion and a scroll region; navigation becomes a row of accessible icon buttons in short windows.
- Connection setup opens directly to the Muse Code settings section. A missing executable has installation guidance, a custom-path picker, and reconnect controls.
- Delayed model selection and diff responses no longer overwrite newer navigation. File-list failures clear stale entries and do not report an empty folder as a successful result.
- macOS CI artifacts now preserve executable permissions. Workflows have timeouts, minimal permissions, pinned action revisions, and a setup/restart smoke test. Dependency update configuration and GitHub contribution/reporting templates are included.
- Packaged apps include the original source license and artwork notices.

## Automated verification

| Check                            | Result                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| TypeScript and production builds | Passed                                                                                                 |
| Unit suite                       | 16 passed                                                                                              |
| Electron suite                   | 11 passed                                                                                              |
| Real CLI echo integration        | Passed across host restart, history recovery, resume, rename, and streaming                            |
| Preference regression            | All five themes × four effort levels; unrelated preferences unchanged; persisted after process restart |
| Sidebar regression               | 880, 780, 740, 680, and 600 px window heights                                                          |
| First-run failure path           | Missing CLI, setup controls, disabled send, preserved settings after restart                           |
| Voice UI                         | Simulated recording, WAV conversion, draft insertion, cancellation, no automatic send                  |
| Dependency audit                 | No reported vulnerabilities                                                                            |
| Bundle contents                  | App entrypoints, SDK, artwork, and notices present; no preferences or CLI state files                  |

CLI transcription was separately verified using generated speech with the installed authenticated CLI. Repository screenshots use isolated synthetic conversations. No real session exports, account credentials, personal absolute paths, or local configuration are included in the source tree.

## Before publishing downloads

- Complete notarization and stapling after the maintainer configures credentials. Verify the final app with `codesign`, `spctl`, and `stapler`; test an actual downloaded, quarantined artifact. Local signing alone is insufficient for that claim.
- Check physical microphone capture and the macOS permission prompt in the final signed build.
- Test on Intel hardware and the oldest supported macOS version. Those environments have not been verified here.
- Confirm redistribution rights for the Muse mark and the reference mascot design; see [NOTICE](../NOTICE.md). The MIT source license does not grant these rights.
- Repository: [robzilla1738/muse-desktop](https://github.com/robzilla1738/muse-desktop). Robert Courson is the sole initial author and code owner. Private security reporting and main-branch history protection are configured at publication.

The GUI supports the workflows listed in [compatibility](compatibility.md). Advanced CLI administration remains available through the Terminal handoff; the app does not claim complete graphical parity with every CLI command.

## Sparkle and public source

Sparkle 2.10.0 is embedded through a small native Node-API bridge. Its upstream archive is checksum-pinned. Both architecture-specific feeds and update archives require Ed25519 signatures. The private key is in the maintainer's Keychain; the repository contains only its public key. The native updater initialized successfully in the signed Apple Silicon app. About includes update controls and an explicit unofficial notice; the sidebar and GitHub metadata also identify the app as unofficial.

The notarization Keychain profile has been configured and validated with Apple. Signed, notarized release verification is recorded separately when the final artifacts are accepted. CI release signing requires separate GitHub Apple credentials; a local Keychain profile is not transferred to GitHub runners automatically.
