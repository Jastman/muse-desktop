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
- Provenance audit (0.3.0-rc.1): the allowlist is now **only** `runtime_info` and
  `pull_request_linking`, the two tags with observed protocol provenance (`tests/unit/activity.test.ts`).
  Earlier extra names (`system-reminder`, `environment_context`, `user_instructions`, `command-*`,
  …) had no verified provenance in this repo and are now displayed as user text. The failure mode
  is extra visible metadata, never lost user text. `tests/unit/message-text.test.ts` pins this.

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

## Phase 3 — Search

- [x] `HistorySearchService`/`SearchIndex` (`src/main/search-index.ts`, `history-search.ts`): local,
      rebuildable, opt-out index with clear/rebuild; derived from CLI history, never authoritative.
- [x] Project/date/archive filters, message anchors, Ctrl/Cmd+F (in-conversation) and
      Ctrl/Cmd+Shift+F (history), paginated command menu.
- [x] Tests: `tests/unit/search-index.test.ts`, `history-search.test.ts`, `find.test.ts`,
      `tests/e2e/search.spec.ts` (fake CLI).
- Fixed in 0.3.0-rc.1: `desktop.spec.ts` "real project files, docs and commands are accessible"
  failed because (a) the command-menu input is now a `combobox` and (b) the first result for any
  query is "Search messages for …", so Enter ran a history search instead of the theme. Both were
  stale test assumptions, not product bugs; the test now uses the combobox role and chooses the
  "Switch to Moonlight" option explicitly. The `data-theme` assertion is unchanged.

## Phases 4–7 — status in this release candidate (0.3.0-rc.1)

Not everything in the original roadmap is implemented. This is the honest state.

| Item                                                                                                                                | Status                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Version single source of truth (`src/shared/version.ts` ← package.json)                                                             | **Done**, tested (`tests/unit/version.test.ts`), verified in built main bundle and packaged asar                |
| Markup provenance audit                                                                                                             | **Done** (see Phase 1)                                                                                          |
| 10,000-item synthetic benchmark                                                                                                     | **Done for the data path** (`npm run benchmark`); renderer/DOM render timing **not measured**                   |
| Diagnostics redaction + bounded log primitives                                                                                      | **Done as a tested library** (`src/main/diagnostics.ts`); **not wired to any UI/IPC**, nothing is collected     |
| CI: fake-CLI E2E on macOS, Linux (Xvfb), Windows; trace upload                                                                      | **Configured, not yet observed running** on all three runners                                                   |
| App.tsx controller split / revisioned IPC deltas / virtualized transcript / paged session fetch                                     | **Not done** (App.tsx still contains the remaining orchestration; transcript renders every item)                |
| Resizable sidebar/inspector, native Win/Linux frame by default, quiet first-run                                                     | Quiet default and Win/Linux shortcuts exist from earlier phases; resizable panes and native frames **not done** |
| Accessibility automation (axe etc.), focus-restore audit, reduced-motion jumps                                                      | **Not done** beyond existing combobox/listbox semantics and tests                                               |
| Task/turn review panel with check evidence, checkpoints/worktrees, plan→execute→verify, project instructions editor, diagnostics UI | **Not done**. No UI for these is shown, so nothing is advertised that does not exist                            |
| Real-CLI integration                                                                                                                | **Not run** (no Muse CLI installed in this environment)                                                         |

## Commands run (0.3.0-rc.1, Linux x64, Node 22.23.3, Electron 44.7.0)

| Command                                                                                                   | Result                                  |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `npm run typecheck`                                                                                       | pass                                    |
| `npx vitest run`                                                                                          | 15 files, 111 tests passed              |
| `npm run format:check`                                                                                    | pass                                    |
| `npx electron-vite build`                                                                                 | pass                                    |
| `xvfb-run -a npx playwright test tests/e2e/setup.spec.ts tests/e2e/core.spec.ts tests/e2e/search.spec.ts` | 14 passed (fake CLI)                    |
| `MUSE_BIN=$PWD/tests/fixtures/fake-muse/muse xvfb-run -a npx playwright test tests/e2e/desktop.spec.ts`   | 10 passed twice (fake CLI)              |
| `npx playwright test tests/e2e/desktop.spec.ts` (no `MUSE_BIN`)                                           | fails at setup: no Muse CLI installed   |
| `npm run benchmark`                                                                                       | pass; see [performance](performance.md) |
| `npx electron-builder --linux --dir`                                                                      | pass; asar contains version 0.3.0-rc.1  |
