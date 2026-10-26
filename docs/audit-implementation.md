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

## Phase 2 — Transparent agent and composer UX

### Activity strip

- [x] `src/renderer/src/agent-activity.ts` derives one state from authoritative data only:
      connection state, pending approvals and questions, `cancelRequested`,
      `turn/retryScheduled`, the latest in-progress item, `turn/completed` (terminal and
      duration), item `patchSummary`, and `userShell`/command `exitCode`/`exitSignal`. It never
      reads model prose.
- [x] `ActivityStrip` sits above the composer, so it stays visible when the transcript is
      scrolled back. It shows:
  - Reading, searching, editing, running a command (with elapsed time) or using a tool. Elapsed
    time is measured from when the desktop first saw the item, because the protocol has no start
    time for items, and is labelled as such.
  - Expandable command output (the last 4,000 characters).
  - "Show in conversation" jumps to the item.
  - "Waiting for your approval" / "Muse has a question", with a button that scrolls to the request
    and focuses its first control.
  - A queued follow-up preview, connection interruptions, model retries, and "Stopping"
    (requested) versus "Stopped" (confirmed).
  - A finished summary: duration, files changed (from `patchSummary`), and commands run with their
    real exit status. Commands without a reported exit code are counted as "without a reported
    exit code" and never as passing. "No commands were run" is stated when that is the case.
- [x] Polite live announcements (an `aria-live="polite"` region) for approvals, questions,
      interruptions and turn completion only. They never fire for streamed tokens or for the
      state found when a conversation is opened. They can be turned off with the
      `announceUpdates` preference.
- [x] Jumping respects reduced motion (instant scroll) and briefly highlights the target.

### Approvals

- [x] Each CLI-provided choice now lists its scope in visible text ("this request only", "the
      rest of this conversation", "saving a local Muse Code rule") together with any
      `rulePreview`. The choices themselves are unchanged and come from the CLI. Keying cards by
      `approvalId` + `currentRequirementId.sourceIndex` (stale-approval protection) is preserved.

### Composer

- [x] See Phase 1 for the send lifecycle, chips, thumbnails, queue/steer wording and effort
      capabilities. The stop button is disabled once stop is requested.
- [x] Keyboard navigation in menus skips disabled (unsupported) options.

### Deterministic fake CLI and E2E

- `tests/fixtures/fake-muse/` is a protocol-level test double of `muse serve`. It is
  deterministic, has no network access and needs no credentials. Scenario keywords (`[approval]`,
  `[crash]`, `[slow]`, `[reject-send]`, …) are documented in its README. It is **not** a real
  CLI integration test.
- `tests/e2e/core.spec.ts` covers, against the fake CLI:
  - faithful markup and a single `turn/start` per send
  - drafts surviving restart, and a rejected send restoring the draft with no replay
  - the approval jump and focus, plus keyboard approval
  - a CLI crash mid-stream → interrupted → manual reconnect → authoritative history (the
    uncommitted partial reply is gone) → follow-up works, with exactly two `turn/start` calls
  - stop requested vs confirmed
  - queued follow-up preview
  - dropped **and** pasted images reaching the CLI with their exact byte count
  - failed command exit codes in the summary, and survival of malformed events
- `tests/e2e/desktop.spec.ts` was written for a real CLI with an echo provider (`MUSE_BIN`).
  It now also passes against the fake CLI (`MUSE_BIN=tests/fixtures/fake-muse/muse`). Changes:
  - It sets the `muse` theme explicitly, because new installs default to the quiet theme.
  - Effort selection tolerates models that report a limited set of efforts.
  - The fake CLI normalizes renamed session names to lowercase. The SDK documents the rename
    result as a canonical, normalized name, and the existing test expects lowercase.

## Phases 3–7

Tracked in later commits of this branch.

## Commands run (latest phase)

| Command                                                                                                                              | Result                    |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| `npx tsc --noEmit`                                                                                                                   | pass                      |
| `npx vitest run`                                                                                                                     | see the latest phase note |
| `npx electron-vite build`                                                                                                            | pass                      |
| `xvfb-run -a npx playwright test tests/e2e/setup.spec.ts tests/e2e/core.spec.ts`                                                     | 10 passed                 |
| `MUSE_BIN=$PWD/tests/fixtures/fake-muse/muse FAKE_MUSE_NODE=$(which node) xvfb-run -a npx playwright test tests/e2e/desktop.spec.ts` | 10 passed                 |
