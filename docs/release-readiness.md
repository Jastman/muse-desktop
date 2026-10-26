# Release candidate 0.3.0-rc.1 — readiness (unsigned, NOT production ready)

Status: **unsigned testable release candidate.** It is not a signed, notarized or published
release, and no tag, release or merge has been made. Details and exact command results are in
[audit-implementation](audit-implementation.md#commands-run-030-rc1-linux-x64-node-22233-electron-447).

| Gate                                                | State                                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Typecheck, unit tests (111), formatting, build      | Passed on Linux x64                                                                              |
| Fake-CLI Electron E2E (14) + `desktop.spec.ts` (10) | Passed on Linux/Xvfb only; macOS/Windows CI configured, not yet observed                         |
| Real Muse CLI integration                           | **Not performed** (CLI not installed here)                                                       |
| Long-history performance                            | Data path measured (`docs/performance.md`); **render/memory not measured**; not virtualized      |
| Version metadata consistent (0.3.0-rc.1)            | Yes: package, lockfile, MSP client info, packaged asar                                           |
| Unsigned Linux package                              | `electron-builder --linux --dir` built; installer/AppImage and Windows/macOS packages left to CI |
| Signing, notarization, Sparkle update install       | **Not performed**; needs maintainer secrets. Appcasts still point to 0.2.0 and were not changed  |
| Screen reader, microphone, native OS manual tests   | **Not performed**                                                                                |
| Roadmap phases 4–7 remainder                        | **Incomplete**; see the status table in audit-implementation                                     |

Fork identity risk: this fork's `package.json` author, appcast/update URLs and Sparkle key still
reference the upstream maintainer. Do not ship updates from the fork until that is decided.

To reproduce an unsigned build: `npm ci && npm run typecheck && npm test && npm run package:linux`
(or `package:win` on Windows, `package:unsigned` on macOS); CI uploads `unsigned-*` artifacts.

---

# Release verification — 0.2.0

Verified October 13, 2026, on Apple Silicon with Muse Code 1.4.7 and SDK 1.4.7. Targets: macOS 13+ (Apple Silicon and Intel), Windows 10/11 (x64 and arm64), and Linux (x64 and arm64).

[Public source and downloads](https://github.com/robzilla1738/muse-desktop/releases/tag/v0.2.0) are maintained by Robert Courson (@robzilla1738), the sole initial contributor and code owner. This is an **unofficial** community companion, not a Meta product. Private vulnerability reporting, secret scanning, push protection, and main-branch deletion/force-push protection are enabled.

## Distribution

Both architecture app bundles and DMG containers are signed with **Developer ID Application: Robert Courson (9F2JXY8TCK)**, accepted by Apple's notarization service, and stapled. Gatekeeper accepts them. The actual ZIP contents were extracted and verified for signature, notarization ticket, architecture, version, and embedded Sparkle key. Release checksums cover both DMGs and both ZIPs.

Sparkle 2.10.0 is embedded through a small Node-API bridge. Its upstream download is SHA-256 pinned. Both update feeds and downloaded archives require Ed25519 signatures. The signing key is stored in the maintainer's Keychain and the protected GitHub `release` environment; only the public key is in source. The live native update check succeeded on Apple Silicon. Installation is user initiated; automatic checks are opt-in and system profiling is disabled.

The local notarization profile `muse-desktop` is configured and validated. GitHub-hosted release automation still requires the Apple certificate and notarization secrets listed in [releasing](releasing.md); a local Keychain profile is not available on GitHub runners.

## Verified behavior

| Check                                     | Result                                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| TypeScript, production builds, formatting | Passed                                                                                              |
| Unit suite                                | 18 passed                                                                                           |
| Electron suite                            | 12 passed                                                                                           |
| Public GitHub CI (macOS, Windows, Linux)  | Configured and verified                                                                             |
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
