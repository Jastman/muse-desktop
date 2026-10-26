# Audit implementation and verification checklist

This file tracks how each recommendation from the Muse Desktop UX and engineering audit was
implemented, how it was verified, and what still needs manual verification. It is updated in
each phase commit. "Verified" means an automated test or a command listed here passed in the
development environment; manual checks are listed separately and are **not** claimed as done
unless they are marked as such.

## Dependencies

- **PR #2** (`copilot/implement-reconnect-attachment-fixes`, head `2b95ddd`) is integrated by
  cherry-pick (`git cherry-pick -x 081de27..2b95ddd`), which keeps its authorship and
  `(cherry picked from commit …)` trailers. It provides the connection epoch, forced reopen after
  reconnect, and the main-process `AttachmentStore` with scoped IDs, content validation and the
  shared picker/drop/paste flow. Its PR was not modified.
- **PR #1** (`copilot/reconnect-attachment-fixes`) contains only an "Initial plan" commit and
  no code changes, so nothing was taken from it. It was not modified.
- If #2 is merged first, this branch's copies of those commits become no-ops on rebase.

## Phase 0 — Dependency integration

- [x] PR #2 commits cherry-picked with attribution; `tsc`, unit tests and prettier pass on top.

## Phase 1 — Reliability and data integrity

### Faithful message text

- [x] `stripInjectedTags`/`cleanMessageText` removed. User messages show `displayText` exactly
      as written when the CLI provides it; the SDK documents it as the client presentation form,
      which the model never sees.
- [x] Raw `text` is shown with only allowlisted protocol metadata blocks removed (complete
      blocks at the very start or end only, for example `<runtime_info>`). Unknown tags and tags
      in the middle of text are always displayed.
- [x] Tests: `tests/unit/message-text.test.ts` (HTML, XML, JSX, code fences, tags in the middle
      of text, unterminated metadata, titles).
- Limitation: the allowlist besides `runtime_info` and `pull_request_linking` is based on known
  CLI/agent conventions. Anything not on the list is shown, so the failure mode is extra
  visible metadata, never lost user text.

### Recoverable preferences

- [x] `loadPreferences` distinguishes missing, valid, older-version (migrated), malformed JSON,
      invalid fields (salvaged field by field), newer-version and unreadable files.
- [x] Malformed, invalid and older-version originals are copied to a timestamped sibling file
      before anything is written. A last-known-good `.bak` is written before each save.
- [x] An unreadable or newer-version file is never overwritten silently. Changes stay in memory
      until the user picks an action in the recovery banner: restore backup, save current
      settings, try again, or reset to defaults (reset needs a second confirmation).
- [x] CLI data, credentials and sessions are never touched. The CLI path is kept on reset.
- [x] Tests: `tests/unit/preferences.test.ts` and `tests/unit/files.test.ts` cover missing,
      v1 migration, malformed, non-object, invalid fields, newer version, unreadable (skipped
      when running as root or on Windows), backup restore and write failure.

### Durable drafts

- [x] `src/main/drafts.ts`: versioned `{schemaVersion: 1, drafts}` store in userData. Writes are
      debounced and atomic (temp file + rename, mode 0600). Limits: at most 200 drafts, 200,000
      characters of text each, 30-day retention. An unreadable or unsupported file is set aside (renamed, not
      deleted) and the user is told.
- [x] Keys are `session:<id>` or `new:<project>`. Main checks every key against a schema;
      `new:` projects must be in the recent-projects list, so the renderer cannot point the store
      at arbitrary paths.
- [x] Attachments: bytes and volatile attachment IDs are **never** persisted. Only name, kind
      and size are stored. After a restart these are shown as dashed "not attached — add it
      again" chips; they are never sent and never shown as valid attachments.
- [x] Voice transcripts keep the draft key captured when recording started, so a project or
      conversation switch while transcribing cannot leak text into another draft.
- [x] Send lifecycle: before sending, a durable `sendState: "sending"` marker is written. - Accepted: the draft is cleared. - Rejected by the CLI (an `MspError`): the optimistic message is rolled back and the text
      and attachments are restored. Failed attachments are rescoped back to the conversation. - Outcome unknown (transport failure after dispatch, or a crash/restart while sending):
      the draft is restored with a warning that the message may already have been sent.
      Nothing is resent automatically; `turn/start` uses a single attempt.
- [x] Settings → Privacy & data → "Clear saved drafts" (with confirmation).
- [x] Tests: `tests/unit/drafts.test.ts` (round trip, debounce, atomic write, retention, limits,
      corrupt and unsupported files, clear).

### Send and cancel states

- [x] The host returns the CLI disposition (`started`, `queued`, `steered`). The composer
      announces "Sending…", "Queued…", "Delivered to the running turn" or "Not sent. Your draft
      was restored." through a polite live region.
- [x] Cancel shows "Stopping — waiting for Muse to confirm" once the CLI accepts the stop
      request. The turn counts as stopped only when `turn/completed` arrives.

### Composer clarity (started here, continued in Phase 2)

- [x] Queue vs steer options explained in plain language.
- [x] Attachment chips show size, type and "included when sent". Dropped or pasted images get
      thumbnails made from the in-memory `File` (`blob:` URLs, revoked when removed or
      unmounted). Picker-chosen files are read by the main process, so they show an icon
      instead of a thumbnail.
- [x] Reasoning effort options come from the model's advertised `variants`. Unsupported efforts
      are disabled with an explanation. If the CLI reports `unknown`, every option stays
      available with a note that support is not guaranteed.

### Reconnect

- [x] From PR #2: reconnect bumps a connection epoch and forces the selected conversation to
      reopen and resubscribe, which restores authoritative items and pending requests.
- Limitation: if the CLI process itself exits, a turn that was running in it, and its pending
  approvals, end with that process. The reopened conversation shows the CLI's stored history.
  No tool action or message is replayed.

## Phases 2–7

Tracked in later commits of this branch.

## Commands run for this phase

| Command                                                   | Result                 |
| --------------------------------------------------------- | ---------------------- |
| `npx tsc --noEmit`                                        | pass                   |
| `npx vitest run`                                          | 8 files, 53 tests pass |
| `npx electron-vite build`                                 | pass                   |
| `xvfb-run -a npx playwright test tests/e2e/setup.spec.ts` | 2 passed               |
| `npx prettier --check .`                                  | pass                   |
