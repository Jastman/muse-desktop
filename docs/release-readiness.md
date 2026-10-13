# Release verification — 0.2.0

Verified October 13, 2026, on Apple Silicon with Muse Code 1.4.7 and SDK 1.4.7. Target: macOS 13+, Apple Silicon and Intel.

[Public source and downloads](https://github.com/robzilla1738/muse-desktop/releases/tag/v0.2.0) are maintained by Robert Courson (@robzilla1738), the sole initial contributor and code owner. This is an **unofficial** community companion, not a Meta product. Private vulnerability reporting, secret scanning, push protection, and main-branch deletion/force-push protection are enabled.

## Distribution

Both architecture app bundles and DMG containers are signed with **Developer ID Application: Robert Courson (9F2JXY8TCK)**, accepted by Apple's notarization service, and stapled. Gatekeeper accepts them. The actual ZIP contents were extracted and verified for signature, notarization ticket, architecture, version, and embedded Sparkle key. Release checksums cover both DMGs and both ZIPs.

Sparkle 2.10.0 is embedded through a small Node-API bridge. Its upstream download is SHA-256 pinned. Both update feeds and downloaded archives require Ed25519 signatures. The signing key is stored in the maintainer's Keychain and the protected GitHub `release` environment; only the public key is in source. The live native update check succeeded on Apple Silicon. Installation is user initiated; automatic checks are opt-in and system profiling is disabled.

The local notarization profile `muse-desktop` is configured and validated. GitHub-hosted release automation still requires the Apple certificate and notarization secrets listed in [releasing](releasing.md); a local Keychain profile is not available on GitHub runners.

## Verified behavior

| Check                                     | Result                                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| TypeScript, production builds, formatting | Passed                                                                                              |
| Unit suite                                | 17 passed                                                                                           |
| Electron suite                            | 11 passed                                                                                           |
| Public GitHub macOS CI                    | Passed                                                                                              |
| Real CLI echo integration                 | Restart, history recovery, resume, rename, streaming                                                |
| Preference regression                     | All five themes × four effort levels; unrelated settings unchanged; persisted after process restart |
| Sidebar regression                        | Conversation scroll area at 880, 780, 740, 680, and 600 px window heights                           |
| First-run failure path                    | Missing CLI, setup guidance, disabled send, preserved settings after restart                        |
| Voice UI                                  | Simulated recording, live waveform, WAV conversion, draft insertion, cancellation, no auto-send     |
| Native updater                            | Initialized in the signed app; signed live GitHub feed check succeeded                              |
| Both release architectures                | Signature, notarization, Gatekeeper, version, architecture, and signed update archive checks passed |
| Dependency audit                          | No reported vulnerabilities                                                                         |

CLI transcription was separately exercised using generated speech with the authenticated installed CLI. Repository screenshots use isolated synthetic conversations. Source excludes credentials, private keys, real transcripts, local preferences, and personal absolute paths.

## Remaining manual coverage

- Physical microphone capture and the macOS permission prompt in the final release.
- Intel hardware and the oldest supported macOS version; both builds were produced and statically verified on Apple Silicon.
- Installation of a future version through Sparkle; this is the first public version. Signed feed retrieval and archive verification have been exercised.
- Authenticated tools and model behavior depend on the user's installed Muse CLI and account. Echo tests do not exercise every external tool or model.

Passing checks does not guarantee zero bugs. Advanced CLI administration uses the Terminal handoff; see [compatibility](compatibility.md). Third-party trademark and character-artwork rights remain separate from the MIT source license; see [NOTICE](../NOTICE.md). The unofficial disclaimer is not a grant of those rights.
