# Contributing

This unofficial project is created and maintained by [Robert Courson (@robzilla1738)](https://github.com/robzilla1738). Meta does not maintain or support it. Robert is the sole initial contributor and code owner. Third-party dependency and asset credits remain in NOTICE.md.

Use Node.js 22.12+ on macOS, Windows, or Linux and run `npm ci`. Start the app with `npm run dev`. Install Muse Code separately when working on the integration.

Keep changes focused. Include a screenshot for appearance changes, describe the user-visible behavior, and explain how it was checked. Interface copy should use sentence case, explicit actions, and the same terms across menus, pages, and dialogs: **project**, **conversation**, **Muse Code**, **Settings**, **Send**, and **New line**. Reserve expressive copy for the welcome headline and mascot greeting.

Before submitting:

```sh
npm run format
npm run build
npm test
npm run test:integration
npm run test:e2e
```

Unit tests run without the CLI. The last two commands require Muse Code and use its echo provider with isolated temporary storage. Never add real transcripts, credentials, personal project paths, environment dumps, or account details to fixtures or screenshots.

Keep Electron privileges in `src/main`. Add explicit typed methods to `src/shared/protocol.ts` and `src/preload` when a renderer feature needs native functionality. Validate data at IPC and CLI boundaries. Never expose arbitrary IPC, shell execution, file paths outside a selected project, or generic credential APIs to the renderer.

For protocol upgrades, update the pinned SDK, run the real-CLI tests, inspect schema fingerprint warnings, and update the compatibility record. Keep approvals user-driven and preserve server-supplied requirement IDs and choice IDs. Do not change a user's permission profile as a side effect of a UI feature.

Open an issue for substantial changes before implementation. Use the repository's private security reporting feature for security-sensitive findings; see `SECURITY.md`.

Packaged macOS builds require Xcode Command Line Tools and compile `native/sparkle.mm` using stable Node-API headers. The pinned Sparkle framework is downloaded and checksum-verified automatically; Windows and Linux builds skip the Sparkle hook and package directly as pure Electron targets. Forks must replace the repository URL, public update key, and keychain account in `scripts/sparkle-config.json`, re-sign their initial feeds, and use their own app identifier and signing identity before distribution. Never distribute a fork that points at the upstream update feed.
