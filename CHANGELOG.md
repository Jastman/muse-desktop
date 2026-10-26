# Changelog

## 0.3.0-rc.1 — unsigned release candidate (not published)

Builds on the merged audit phases 1–3 (durable drafts, preference recovery, activity strip,
approvals, history search, find). Changes in this candidate:

- Fixed the stale `desktop.spec.ts` command-menu test (combobox role, explicit theme option).
- User-message metadata stripping now only removes `runtime_info` and `pull_request_linking`
  blocks; other tag-like text is always shown.
- Application version now comes from `package.json` (`src/shared/version.ts`), including the MSP
  client info; version/lockfile consistency is tested.
- Added `npm run benchmark` (10,000-item data-path benchmark) and `docs/performance.md`.
- Added tested diagnostics redaction/bounded-log primitives (`src/main/diagnostics.ts`). They are
  not wired to the UI and nothing is collected or uploaded.
- CI runs fake-CLI end-to-end tests on macOS, Linux (Xvfb) and Windows.

Not included: transcript virtualization, revisioned IPC deltas, controller split, resizable panes,
review/checkpoint/plan/instruction workspaces. See `docs/audit-implementation.md`.

## 0.2.0

Last public release (signed and notarized on macOS).
