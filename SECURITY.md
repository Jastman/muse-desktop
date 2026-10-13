# Security

The supported development line is 0.1.x. Use the [private reporting form](https://github.com/robzilla1738/muse-desktop/security/advisories/new) to contact Robert Courson. Use **Security → Report a vulnerability** to contact the maintainers privately; if unavailable, request a private reporting channel without posting exploit details or personal data.

Include the app and CLI versions, platform, minimal reproduction, impact, and whether the issue crosses the renderer/main boundary, a project-file boundary, or an approval boundary. Do not include tokens, production transcripts, or a user's home-directory contents.

## Boundaries

- The renderer is sandboxed, uses context isolation, and has no Node integration. It has a narrow context bridge, a restrictive content-security policy, no webviews, and no remote navigation.
- Main-process IPC accepts only the app's top-level frame and validates its arguments. External links accept HTTP(S) only.
- File previews resolve real paths inside explicitly selected projects. Directory listing skips symlinks and dependency folders. File and output previews have size limits.
- Muse Code runs with the user's inherited environment and credentials. A native project trust prompt gates session creation and resume. The app passes `--trust-workspace` only because it performs that desktop trust step; it does not disable sandboxing or tool approvals.
- Approval decisions require a currently pending server-issued choice and requirement token. The GUI never automatically approves a tool call.
- Main-process preferences use atomic writes and restrictive file permissions. No analytics or crash upload is configured by Desktop. Muse Code has its own separate network and data behavior.

The app is a coding-agent interface, so a trusted project and an approved CLI action can modify files and run processes using the CLI's configured permissions. A project trust prompt is not a substitute for the CLI's sandbox.

Sparkle verifies signed feeds and update archives using a pinned Ed25519 public key, and verifies the application signature. Private update keys are never bundled. Packaging verifies the pinned upstream Sparkle archive checksum. Release automation requires notarization and Gatekeeper checks before publishing an update feed. Automatic installation is disabled.
