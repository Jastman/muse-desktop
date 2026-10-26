# Fake Muse CLI (test fixture)

A **deterministic test double** of the `muse` CLI for unit tests and Playwright Electron E2E
tests on macOS, Windows, and Linux. It speaks enough of the Muse Session Protocol (MSP:
newline-delimited JSON-RPC 2.0 over stdio, as consumed by `@muse-code/sdk`) to drive Muse
Desktop with no network access and no model credentials.

It is **not** a real CLI integration test. Passing tests here prove the app handles the
protocol shapes this fixture emits. They do not prove compatibility with a real Muse Code
release. Use `npm run test:integration` against a real CLI for that.

## Files

- `fake-muse.mjs`: the implementation. Plain Node ESM with only built-in modules. It imports
  `@muse-code/sdk` only to read `EXPECTED_SCHEMA_FINGERPRINT` and falls back to a pinned copy.
- `muse`: POSIX wrapper (must be executable). Point the app's CLI path at it.
- `muse.cmd`: Windows wrapper (CRLF line endings). The app runs it through `cmd.exe /d /s /c`.

Both wrappers run `node`, or `$FAKE_MUSE_NODE` when that is set. `discoverCli` replaces `PATH`
with the login shell's `PATH`, which may not include the `node` used by the test runner. Tests
should therefore set `FAKE_MUSE_NODE=process.execPath` (or a Node path for Electron E2E).

## Commands

| Command                                         | Behaviour                                                                                                                           |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `muse --version`                                | Prints `Muse Code 0.0.0-fake (deterministic test fixture)`                                                                          |
| `muse voice transcribe <file>`                  | Checks that the file exists and prints `Fake transcription`                                                                         |
| `muse seed <workspaceRoot> <itemCount> [title]` | Writes a durable session of alternating user and agent messages (with markdown and code fences every 10th item), then prints its id |
| `muse serve [--trust-workspace] [--provider …]` | MSP server on stdio. It exits 0 on stdin EOF. Only JSON lines go to stdout; diagnostics go to stderr                                |

## Storage and leases

Sessions are stored as `$MUSE_HOME/fake-muse/<sessionId>.json`. When `MUSE_HOME` is unset, the
default is `<os.tmpdir()>/fake-muse-home`. Each file is rewritten atomically (temp file, then
rename) after every item completion and session change, so history survives a restart or a
crash. In-progress items are never persisted. After a `[crash]`, the partial agent reply is
therefore absent from disk.

A serve process only "loads" sessions that it started (`session/start`) or resumed
(`session/resume`). Other sessions on disk can still be read with `session/read`, `view/page`,
and `session/list`. However, `view/subscribe`, `turn/start`, and similar calls on those
sessions fail with `sessionNotLoaded`, which simulates CLI leases.

`session/read` returns inline history unless the session has more than
`FAKE_MUSE_INLINE_LIMIT` items. In that case it returns `mode: 'none'` and the client pages
with `view/page`. The last paged event's `viewCursor` equals the session's head cursor.

## Prompt scenarios (keywords can be combined)

| Keyword                   | Effect                                                                                                                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| _(none)_                  | Streams `Echo: <displayText or text>` in 8-character `item/delta` chunks                                                                                                                                                                                                       |
| image or extra text parts | Each image adds `Received image <mediaType> (<bytes> bytes)`. Each text part after the first adds `Received text attachment: <first line>`                                                                                                                                     |
| `[approval]`              | Runs a `shell` tool call (`npm test`) and emits `approval/requested`. On allow: `All 3 tests passed`. On deny: the tool is `rejected` with `Denied by user`. A stale `requirementId` returns `approvalRequirementStale`, and a second decide returns `approvalAlreadyResolved` |
| `[question]`              | Emits `userInput/requested` (Alpha/Beta). The reply is `You chose <label>` or `Question cancelled`                                                                                                                                                                             |
| `[slow]`                  | 200 chunks, 50 ms apart (about 10 s), so cancellation can be tested                                                                                                                                                                                                            |
| `[crash]`                 | Exits with status 70 after 3 deltas                                                                                                                                                                                                                                            |
| `[big]`                   | A `cat big.log` tool call with 300,000 visible characters, `truncated: true`, and an `outputRef` of 2 MiB that `item/readOutput` can read                                                                                                                                      |
| `[malformed]`             | Emits an `item/completed` without `itemId` and a raw `{not json` line, then continues                                                                                                                                                                                          |
| `[shell-fail]`            | A `userShell` item (`npm test`, exit 1) and a failed `npm run lint` tool call                                                                                                                                                                                                  |
| `[edit]`                  | Appends `edited by fake muse <turn n>` to `<workspaceRoot>/fake-muse-edit.txt`, but only when the workspace is a directory                                                                                                                                                     |
| `[todo]`                  | Emits `session/todoListChanged`                                                                                                                                                                                                                                                |
| `[gap]`                   | Skips a view cursor and emits `view/gap`                                                                                                                                                                                                                                       |
| `[retry]`                 | Emits `turn/retryScheduled` and waits 100 ms                                                                                                                                                                                                                                   |
| `[fail]`                  | Ends the turn `failed` with `{ kind: 'modelError', message: 'Fake model error' }` and no reply                                                                                                                                                                                 |
| `[reject-send]`           | `turn/start` fails with `invalidParams` (`Fake rejection`) and no turn starts                                                                                                                                                                                                  |

When a turn is busy, `ifBusy: 'queue'` queues the new turn and `'steer'` appends a steered user
message to the running turn. `turn/cancel` acknowledges immediately and stops the turn after
`FAKE_MUSE_CANCEL_DELAY_MS`.

## Environment variables

| Variable                    | Default                | Purpose                                                                                |
| --------------------------- | ---------------------- | -------------------------------------------------------------------------------------- |
| `MUSE_HOME`                 | `<tmp>/fake-muse-home` | Storage root                                                                           |
| `FAKE_MUSE_NODE`            | `node`                 | Node binary used by the wrappers                                                       |
| `FAKE_MUSE_STREAM_DELAY_MS` | `15`                   | Delay between reply chunks                                                             |
| `FAKE_MUSE_CANCEL_DELAY_MS` | `300`                  | Delay between the `turn/cancel` ack and the turn actually stopping (UI: "Stopping…")   |
| `FAKE_MUSE_INLINE_LIMIT`    | `2000`                 | Item count above which `session/read` and `session/resume` return `mode: 'none'`       |
| `FAKE_MUSE_APPROVAL_UPDATE` | unset                  | `1` emits `approval/updated` (`sourceIndex` 0 → 1) 200 ms after each approval request  |
| `FAKE_MUSE_FAIL_INITIALIZE` | unset                  | `1` makes `serve` exit with status 3 before the handshake                              |
| `FAKE_MUSE_LOG`             | unset                  | Appends every received method name to this file (to check that sends are not replayed) |
| `FAKE_MUSE_VOICE_TEXT`      | `Fake transcription`   | Voice transcription output                                                             |
| `FAKE_MUSE_VOICE_DELAY_MS`  | `0`                    | Voice transcription delay                                                              |
| `FAKE_MUSE_VOICE_FAIL`      | unset                  | `1` makes voice transcription exit with status 1                                       |
