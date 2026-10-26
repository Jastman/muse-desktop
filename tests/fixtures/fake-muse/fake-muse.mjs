#!/usr/bin/env node
// Deterministic FAKE Muse Code CLI used by unit and E2E tests. It is a test double that speaks
// enough of the Muse Session Protocol (MSP, newline-delimited JSON-RPC 2.0 over stdio) to drive
// Muse Desktop without network access or model credentials. It is NOT a real CLI integration.
import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { setTimeout as sleepTimer } from 'node:timers/promises'

const VERSION = '0.0.0-fake'
const FALLBACK_FINGERPRINT =
  'sha256:6de32db08bbbe0deb478d2bfcaba001e9fb490986bc80db3aceb4d996abf7df9'

const env = process.env
const numberEnv = (name, fallback) => {
  const value = Number(env[name])
  return env[name] !== undefined && env[name] !== '' && Number.isFinite(value) ? value : fallback
}
const STREAM_DELAY_MS = numberEnv('FAKE_MUSE_STREAM_DELAY_MS', 15)
const CANCEL_DELAY_MS = numberEnv('FAKE_MUSE_CANCEL_DELAY_MS', 300)
const INLINE_LIMIT = numberEnv('FAKE_MUSE_INLINE_LIMIT', 2000)
const MUSE_HOME = env.MUSE_HOME || join(tmpdir(), 'fake-muse-home')
const STORE = join(MUSE_HOME, 'fake-muse')
const BIG_OUTPUT_BYTES = 2 * 1024 * 1024
const BIG_VISIBLE_CHARS = 300_000
const SLOW_CHUNKS = 200
const SLOW_DELAY_MS = 50
const CHUNK_CHARS = 8

const log = (...parts) => process.stderr.write(`[fake-muse] ${parts.join(' ')}\n`)

// ---------------------------------------------------------------------------------------------
// Errors (every error carries data.kind, which the SDK exposes as MspError.kind)
// ---------------------------------------------------------------------------------------------

const ERROR_CODES = {
  invalidParams: -32602,
  methodNotFound: -32601,
  internal: -32603,
  notInitialized: -32002,
  alreadyInitialized: -32003,
  notFound: -32004,
  sessionNotFound: -32020,
  sessionNotLoaded: -32021,
  outputUnavailable: -32041,
  approvalNotFound: -32050,
  approvalAlreadyResolved: -32051,
  approvalChoiceInvalid: -32052,
  approvalRequirementStale: -32053,
  userInputNotFound: -32055,
  userInputAlreadySettled: -32056,
  userInputAnswerInvalid: -32057,
}

class RpcError extends Error {
  constructor(kind, message, data = {}) {
    super(message)
    this.code = ERROR_CODES[kind] ?? -32603
    this.data = { kind, retryable: false, ...data }
  }
}

// ---------------------------------------------------------------------------------------------
// Durable store: one JSON file per session under $MUSE_HOME/fake-muse/
// ---------------------------------------------------------------------------------------------

const now = () => new Date().toISOString()
const cursorOf = (seq) => `v${String(seq).padStart(12, '0')}`
const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(id)
const sessionFile = (sessionId) => join(STORE, `${sessionId}.json`)

function writeAtomic(path, text) {
  mkdirSync(STORE, { recursive: true })
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temp, text)
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(temp, path)
      return
    } catch (error) {
      // Windows can briefly refuse to replace a file another process is reading.
      if (attempt >= 20) {
        try {
          unlinkSync(temp)
        } catch {
          // ignore
        }
        throw error
      }
      const until = Date.now() + 10
      while (Date.now() < until) {
        // A short synchronous back-off keeps persistence ordered.
      }
    }
  }
}

function recordOf(state) {
  return {
    format: 'fake-muse-session/1',
    session: { ...state.session, status: 'idle', activeTurnId: null },
    // In-progress items are not durable: a crash mid-stream loses the partial agent reply.
    items: state.items.filter((item) => item.status !== 'inProgress'),
    viewEvents: state.viewSeq,
    lastTurn: state.lastTurn ?? null,
    usage: state.usage,
  }
}

function persist(state) {
  writeAtomic(sessionFile(state.session.sessionId), JSON.stringify(recordOf(state)))
}

const diskCache = new Map()
function readRecord(sessionId) {
  if (!validId(sessionId)) return undefined
  const path = sessionFile(sessionId)
  let stat
  try {
    stat = statSync(path)
  } catch {
    return undefined
  }
  const cached = diskCache.get(path)
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.record
  try {
    const record = JSON.parse(readFileSync(path, 'utf8'))
    diskCache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, record })
    return record
  } catch (error) {
    log('could not read session', sessionId, String(error))
    return undefined
  }
}

function stateFromRecord(record) {
  return {
    session: { ...record.session, status: 'idle', activeTurnId: null },
    items: record.items.map((item) => ({ ...item })),
    viewSeq: record.viewEvents ?? record.items.length,
    lastTurn: record.lastTurn ?? undefined,
    usage: record.usage ?? { promptTokens: 0, outputTokens: 0, totalTokens: 0 },
    activeTurn: null,
    queue: [],
    approvals: new Map(),
    userInputs: new Map(),
    resolvedApprovals: new Set(),
    settledInputs: new Set(),
    subscribed: false,
  }
}

function newSession(workspaceRoot, modelId, extra = {}) {
  const sessionId = randomUUID()
  const at = now()
  return {
    sessionId,
    workspaceRoot,
    createdAt: at,
    updatedAt: at,
    lastActivityAt: at,
    status: 'idle',
    activeTurnId: null,
    modelId,
    providerId: 'fake',
    path: sessionFile(sessionId),
    forkedFrom: null,
    turnCount: 0,
    kind: 'root',
    approvalMode: { mode: 'promptUnmatched', source: 'startup', lastCommandId: null },
    ...extra,
  }
}

// ---------------------------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------------------------

async function voice(args) {
  if (args[0] !== 'transcribe' || !args[1]) {
    process.stderr.write('usage: muse voice transcribe <file>\n')
    process.exit(2)
  }
  if (!existsSync(args[1])) {
    process.stderr.write(`fake-muse: recording not found: ${args[1]}\n`)
    process.exit(1)
  }
  const delay = numberEnv('FAKE_MUSE_VOICE_DELAY_MS', 0)
  if (delay > 0) await sleepTimer(delay)
  if (env.FAKE_MUSE_VOICE_FAIL === '1') {
    process.stderr.write('fake-muse: voice transcription failed (FAKE_MUSE_VOICE_FAIL=1)\n')
    process.exit(1)
  }
  process.stdout.write(`${env.FAKE_MUSE_VOICE_TEXT || 'Fake transcription'}\n`)
}

function syntheticText(n) {
  const base = `Synthetic message ${n} about topic-${n % 37}`
  if (n % 10 !== 0) return base
  return `${base}\n\n**Checkpoint ${n}** with a list:\n\n- alpha\n- beta\n\n\`\`\`ts\nconst value${n} = ${n} * 2\nconsole.log(value${n})\n\`\`\``
}

function seed(args) {
  const [workspaceRoot, countText, title] = args
  const count = Number(countText)
  if (!workspaceRoot || !Number.isInteger(count) || count < 0) {
    process.stderr.write('usage: muse seed <workspaceRoot> <itemCount> [title]\n')
    process.exit(2)
  }
  const items = []
  const base = Date.parse('2026-01-01T00:00:00.000Z')
  for (let index = 1; index <= count; index++) {
    const user = index % 2 === 1
    const text = syntheticText(index)
    items.push({
      itemId: `item-${String(index).padStart(6, '0')}`,
      kind: user ? 'userMessage' : 'agentMessage',
      revision: user ? 1 : 2,
      status: 'completed',
      turnId: `turn-${String(Math.ceil(index / 2)).padStart(6, '0')}`,
      text,
      ...(user ? { displayText: text } : {}),
      recordedAt: new Date(base + index * 1000).toISOString(),
    })
  }
  const firstPrompt = items[0]?.text
  const session = newSession(workspaceRoot, 'fake-fast', {
    turnCount: Math.ceil(count / 2),
    ...(firstPrompt ? { firstUserPrompt: firstPrompt } : {}),
    title: title || (firstPrompt ? firstPrompt.slice(0, 40) : 'Seeded session'),
  })
  persist(stateFromRecord({ session, items, viewEvents: count }))
  process.stdout.write(`${session.sessionId}\n`)
}

// ---------------------------------------------------------------------------------------------
// MSP server
// ---------------------------------------------------------------------------------------------

/** Sessions loaded (leased) by THIS serve process. Others are readable from disk only. */
const loaded = new Map()
let initialized = false
let fingerprint = FALLBACK_FINGERPRINT

function out(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}
function notify(method, params) {
  out({ jsonrpc: '2.0', method, params })
}
function nextCursor(state) {
  state.viewSeq += 1
  return cursorOf(state.viewSeq)
}
function sourceRange(state) {
  const position = { id: `rec-${state.viewSeq}`, sequence: state.viewSeq }
  return {
    stream: { id: state.session.sessionId, kind: 'fakeSessionLog' },
    first: position,
    last: position,
  }
}
function viewNotify(state, method, params) {
  const viewCursor = nextCursor(state)
  notify(method, {
    ...params,
    sessionId: state.session.sessionId,
    sourceRange: sourceRange(state),
    viewCursor,
  })
  return viewCursor
}
function listChanged(state) {
  notify('session/listChanged', { session: { ...state.session } })
}
function touch(state) {
  const at = now()
  state.session.updatedAt = at
  state.session.lastActivityAt = at
}

function requireSessionId(params) {
  const sessionId = params?.sessionId
  if (typeof sessionId !== 'string' || !sessionId)
    throw new RpcError('invalidParams', 'sessionId is required')
  return sessionId
}

/** Returns the loaded state, or a transient read-only state from disk. */
function peekSession(sessionId) {
  const live = loaded.get(sessionId)
  if (live) return live
  const record = readRecord(sessionId)
  if (!record)
    throw new RpcError('sessionNotFound', `Session ${sessionId} was not found`, { sessionId })
  return stateFromRecord(record)
}
function loadSession(sessionId) {
  const live = loaded.get(sessionId)
  if (live) return live
  const state = peekSession(sessionId)
  loaded.set(sessionId, state)
  return state
}
function loadedSession(sessionId) {
  const live = loaded.get(sessionId)
  if (live) return live
  peekSession(sessionId)
  throw new RpcError('sessionNotLoaded', `Session ${sessionId} is not loaded in this process`, {
    sessionId,
  })
}

function pendingPointers(state) {
  return [
    ...[...state.approvals.values()].map((entry) => ({
      kind: 'approval',
      approvalId: entry.request.approvalId,
      viewCursor: entry.request.viewCursor,
    })),
    ...[...state.userInputs.values()].map((entry) => ({
      kind: 'userInput',
      userInputId: entry.request.userInputId,
      viewCursor: entry.request.viewCursor,
    })),
  ]
}

function historyResult(state, { excludeItems = false } = {}) {
  const tooMany = state.items.length > INLINE_LIMIT
  const history =
    excludeItems || tooMany
      ? {
          mode: 'none',
          items: null,
          snapshot: null,
          noneReason: excludeItems ? 'excluded' : 'historyBudget',
        }
      : { mode: 'inline', items: state.items.map((item) => ({ ...item })), snapshot: null }
  return {
    session: { ...state.session },
    viewCursor: cursorOf(state.viewSeq),
    history,
    pendingRequests: pendingPointers(state),
    ...(state.lastTurn ? { lastTurn: state.lastTurn } : {}),
  }
}

const MODELS = [
  {
    modelId: 'fake-fast',
    displayLabel: 'Fake Fast',
    providerId: 'fake',
    isDefault: true,
    contextLimit: 128000,
    outputLimit: 8192,
    cost: null,
    description: 'Deterministic fake model',
    profileId: null,
    releaseDate: null,
    defaultReasoningEffort: 'medium',
    reasoningEffortVariants: [{ tier: 'low' }, { tier: 'medium' }, { tier: 'high' }],
    variants: ['low', 'medium', 'high'],
  },
  {
    modelId: 'fake-unknown-effort',
    displayLabel: 'Fake Unknown Effort',
    providerId: 'fake',
    isDefault: false,
    contextLimit: null,
    outputLimit: null,
    cost: null,
    description: null,
    profileId: null,
    releaseDate: null,
    variants: 'unknown',
  },
]

// --- items ---------------------------------------------------------------------------------

function upsertItem(state, item) {
  const index = state.items.findIndex((entry) => entry.itemId === item.itemId)
  if (index >= 0) state.items[index] = item
  else state.items.push(item)
}
function startItem(turn, fields) {
  const { state } = turn
  const item = {
    itemId: `item-${randomUUID()}`,
    revision: 1,
    status: 'inProgress',
    turnId: turn.turnId,
    recordedAt: now(),
    ...fields,
  }
  upsertItem(state, item)
  turn.inProgress.set(item.itemId, { item, text: '' })
  viewNotify(state, 'item/started', { item: { ...item } })
  return item
}
function completeItem(turn, item, fields) {
  const { state } = turn
  const done = { ...item, ...fields, revision: item.revision + 1 }
  if (done.status === 'inProgress') done.status = 'completed'
  turn.inProgress.delete(item.itemId)
  upsertItem(state, done)
  viewNotify(state, 'item/completed', { item: { ...done } })
  touch(state)
  persist(state)
  return done
}
function instantItem(turn, fields) {
  const { state } = turn
  const item = {
    itemId: `item-${randomUUID()}`,
    revision: 1,
    status: 'completed',
    turnId: turn.turnId,
    recordedAt: now(),
    ...fields,
  }
  upsertItem(state, item)
  viewNotify(state, 'item/started', { item: { ...item } })
  viewNotify(state, 'item/completed', { item: { ...item } })
  touch(state)
  persist(state)
  return item
}

function abortable(turn, promise) {
  const { signal } = turn.controller
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}
const sleep = (turn, ms) => abortable(turn, sleepTimer(ms))

async function streamAgentMessage(turn, text, { delay = STREAM_DELAY_MS, crashAfter } = {}) {
  const item = startItem(turn, { kind: 'agentMessage', text: '' })
  const entry = turn.inProgress.get(item.itemId)
  let sent = 0
  for (let offset = 0; offset < text.length; offset += CHUNK_CHARS) {
    await sleep(turn, delay)
    const delta = text.slice(offset, offset + CHUNK_CHARS)
    entry.text += delta
    viewNotify(turn.state, 'item/delta', { itemId: item.itemId, delta, field: 'text' })
    sent += 1
    if (crashAfter !== undefined && sent >= crashAfter) {
      log('simulating a CLI crash mid-stream ([crash]); exiting with status 70')
      process.stdout.write('', () => process.exit(70))
      await new Promise(() => {})
    }
  }
  completeItem(turn, item, { status: 'completed', text })
}

// --- scenarios -----------------------------------------------------------------------------

let bigCache
function bigText() {
  if (bigCache) return bigCache
  const lines = []
  let length = 0
  for (let line = 1; length < BIG_OUTPUT_BYTES; line++) {
    const text = `line ${String(line).padStart(7, '0')}: deterministic fake output for big.log\n`
    lines.push(text)
    length += text.length
  }
  bigCache = lines.join('').slice(0, BIG_OUTPUT_BYTES)
  return bigCache
}

async function approvalScenario(turn) {
  const { state } = turn
  const approvalId = `approval-${randomUUID()}`
  const rawArgs = '{"command":"npm test"}'
  const tool = startItem(turn, {
    kind: 'toolCall',
    tool: 'shell',
    args: rawArgs,
    commandText: 'npm test',
    approvalId,
    callId: `call-${approvalId}`,
  })
  const request = {
    approvalId,
    sessionId: state.session.sessionId,
    toolName: 'shell',
    rawArgs,
    itemId: tool.itemId,
    turnId: turn.turnId,
    taskId: '',
    toolCallId: `call-${approvalId}`,
    judgeEscalated: false,
    protectedWrite: false,
    currentRequirementId: { approvalId, sourceIndex: 0 },
    subject: { kind: 'command', command: 'npm test' },
    availableChoices: [
      { choiceId: 'once', label: 'Allow once', decision: 'approved', scope: 'once' },
      {
        choiceId: 'session',
        label: 'Allow for session',
        decision: 'approvedForSession',
        scope: 'session',
        rulePreview: 'shell: npm test',
      },
      { choiceId: 'deny', label: 'Deny', decision: 'denied', scope: 'once', acceptsFeedback: true },
    ],
  }
  let resolve
  const decided = new Promise((done) => (resolve = done))
  state.approvals.set(approvalId, { request, resolve, turn })
  request.viewCursor = viewNotify(state, 'approval/requested', request)
  request.sourceRange = sourceRange(state)
  let updateTimer
  if (env.FAKE_MUSE_APPROVAL_UPDATE === '1') {
    updateTimer = setTimeout(() => {
      if (!state.approvals.has(approvalId)) return
      request.currentRequirementId = { approvalId, sourceIndex: 1 }
      request.viewCursor = viewNotify(state, 'approval/updated', {
        approvalId,
        availableChoices: request.availableChoices,
        change: { kind: 'requirementAdvanced', requirementId: request.currentRequirementId },
        currentRequirementId: request.currentRequirementId,
        subject: request.subject,
      })
    }, 200)
  }
  try {
    const choice = await abortable(turn, decided)
    if (choice.decision !== 'denied') {
      completeItem(turn, tool, {
        status: 'completed',
        visibleOutput: 'All 3 tests passed',
        durationMs: 1234,
        exitCode: 0,
      })
      return 'Approved: npm test passed (All 3 tests passed).'
    }
    completeItem(turn, tool, { status: 'rejected', failureReason: 'Denied by user' })
    return 'Denied: npm test was not run.'
  } finally {
    clearTimeout(updateTimer)
    if (state.approvals.delete(approvalId)) {
      // The turn was cancelled while waiting, so the request is aborted.
      state.resolvedApprovals.add(approvalId)
      viewNotify(state, 'approval/resolved', {
        approvalId,
        decision: 'abort',
        itemId: tool.itemId,
        policyResult: 'deny',
        resolvedBy: 'user',
        stageEvidence: [],
        turnId: turn.turnId,
      })
    }
  }
}

function settlement(answers, outcome, commandId, userInputId) {
  return {
    userInputId,
    answers,
    clarification: null,
    decidedAt: now(),
    decidedByCommandId: commandId,
    outcome,
    reason: null,
  }
}

async function questionScenario(turn) {
  const { state } = turn
  const userInputId = `input-${randomUUID()}`
  const tool = startItem(turn, { kind: 'toolCall', tool: 'ask_user', args: '{}' })
  const request = {
    userInputId,
    sessionId: state.session.sessionId,
    itemId: tool.itemId,
    toolCallId: `call-${userInputId}`,
    toolName: 'ask_user',
    turnId: turn.turnId,
    questions: [
      {
        id: 'q1',
        header: 'Pick',
        question: 'Which option?',
        options: [{ label: 'Alpha' }, { label: 'Beta' }],
        selection: { mode: 'single' },
      },
    ],
  }
  let resolve
  const settled = new Promise((done) => (resolve = done))
  state.userInputs.set(userInputId, { request, resolve, turn })
  request.viewCursor = viewNotify(state, 'userInput/requested', request)
  try {
    const result = await abortable(turn, settled)
    if (result.outcome === 'answered') {
      const answer = result.answers[0] ?? {}
      const chosen = answer.selectedLabel ?? answer.selectedLabels?.[0] ?? answer.freeText ?? ''
      completeItem(turn, tool, { status: 'completed', visibleOutput: chosen })
      return `You chose ${chosen}`
    }
    completeItem(turn, tool, { status: 'cancelled' })
    return 'Question cancelled'
  } finally {
    if (state.userInputs.delete(userInputId)) {
      state.settledInputs.add(userInputId)
      viewNotify(state, 'userInput/settled', settlement([], 'aborted', null, userInputId))
    }
  }
}

async function runScenarios(turn, prompt) {
  const { state, text, displayText, input } = turn
  const has = (keyword) => text.includes(`[${keyword}]`)
  const lines = []

  if (has('retry')) {
    viewNotify(state, 'turn/retryScheduled', {
      turnId: turn.turnId,
      attempt: 1,
      maxAttempts: 3,
      nextAttempt: 2,
      reason: 'Fake rate limit',
      errorKind: 'rateLimited',
      httpStatus: 429,
      retryDelayMs: 100,
    })
    await sleep(turn, 100)
    lines.push('Recovered after a scheduled retry.')
  }
  if (has('todo')) {
    state.todoRevision = (state.todoRevision ?? 0) + 1
    viewNotify(state, 'session/todoListChanged', {
      items: [
        { text: 'Inspect code', status: 'completed', activeForm: 'Inspecting code' },
        { text: 'Run tests', status: 'inProgress', activeForm: 'Running tests' },
        { text: 'Summarize', status: 'pending', activeForm: 'Summarizing' },
      ],
      revision: state.todoRevision,
      sourceTool: 'todo_write',
    })
  }
  if (has('gap')) {
    const after = cursorOf(state.viewSeq)
    state.viewSeq += 1 // The skipped position is the "missed" update.
    notify('view/gap', {
      sessionId: state.session.sessionId,
      after,
      next: cursorOf(state.viewSeq + 1),
    })
  }
  if (has('malformed')) {
    notify('item/completed', {
      sessionId: state.session.sessionId,
      viewCursor: nextCursor(state),
      item: { kind: 'agentMessage', revision: 1, status: 'completed', text: 'malformed item' },
    })
    process.stdout.write('{not json\n')
  }
  if (has('shell-fail')) {
    instantItem(turn, {
      kind: 'userShell',
      commandText: 'npm test',
      exitCode: 1,
      visibleOutput: '1 failing',
      durationMs: 420,
    })
    const tool = startItem(turn, {
      kind: 'toolCall',
      tool: 'shell',
      args: '{"command":"npm run lint"}',
      commandText: 'npm run lint',
    })
    completeItem(turn, tool, { status: 'failed', failureReason: 'exit status 2', exitCode: 2 })
    lines.push('The shell commands failed.')
  }
  if (has('edit')) {
    const root = state.session.workspaceRoot
    const tool = startItem(turn, {
      kind: 'toolCall',
      tool: 'edit_file',
      args: JSON.stringify({ path: 'fake-muse-edit.txt' }),
    })
    let isDirectory = false
    try {
      isDirectory = typeof root === 'string' && statSync(root).isDirectory()
    } catch {
      isDirectory = false
    }
    if (isDirectory) {
      appendFileSync(join(root, 'fake-muse-edit.txt'), `edited by fake muse ${turn.number}\n`)
      completeItem(turn, tool, {
        status: 'completed',
        patchSummary: { added: 1, removed: 0, files: 1 },
      })
      lines.push('Edited fake-muse-edit.txt.')
    } else {
      completeItem(turn, tool, { status: 'failed', failureReason: 'Workspace folder is missing' })
      lines.push('Could not edit: the workspace folder is missing.')
    }
  }
  if (has('big')) {
    const tool = startItem(turn, {
      kind: 'toolCall',
      tool: 'shell',
      args: '{"command":"cat big.log"}',
      commandText: 'cat big.log',
    })
    completeItem(turn, tool, {
      status: 'completed',
      visibleOutput: bigText().slice(0, BIG_VISIBLE_CHARS),
      truncated: true,
      outputRef: {
        id: `out-${tool.itemId}`,
        byteLen: BIG_OUTPUT_BYTES,
        availability: 'available',
        kind: 'toolOutput',
        mediaType: 'text/plain',
        uri: `fake-muse://output/${tool.itemId}`,
      },
      durationMs: 50,
    })
    lines.push('Printed big.log (truncated).')
  }
  if (has('approval')) lines.push(await approvalScenario(turn))
  if (has('question')) lines.push(await questionScenario(turn))

  for (const part of input) {
    if (part?.type === 'image') {
      const bytes = Buffer.from(String(part.base64Data ?? ''), 'base64').length
      lines.push(`Received image ${part.mediaType ?? 'unknown'} (${bytes} bytes)`)
    }
  }
  for (const part of input.filter((entry) => entry?.type === 'text').slice(1))
    lines.push(`Received text attachment: ${String(part.text).split(/\r?\n/)[0]}`)

  if (has('fail')) {
    turn.error = { kind: 'modelError', message: 'Fake model error', retryable: false }
    return
  }

  lines.push(`Echo: ${displayText || prompt}`)
  let reply = lines.join('\n\n')
  const slow = has('slow')
  if (slow) {
    const target = SLOW_CHUNKS * CHUNK_CHARS
    while (reply.length < target) reply += ' streaming slowly'
    reply = reply.slice(0, target)
  }
  turn.replyLength = reply.length
  await streamAgentMessage(turn, reply, {
    delay: slow ? SLOW_DELAY_MS : STREAM_DELAY_MS,
    ...(has('crash') ? { crashAfter: 3 } : {}),
  })
}

// --- turns ---------------------------------------------------------------------------------

function textOf(input) {
  return input
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n\n')
}

function userMessage(turn, text, displayText, commandId, extra = {}) {
  return instantItem(turn, {
    kind: 'userMessage',
    text,
    ...(displayText ? { displayText } : {}),
    commandId,
    ...extra,
  })
}

function launch(state, turn) {
  runTurn(state, turn).catch((error) => log('turn crashed', String(error?.stack ?? error)))
}

async function runTurn(state, turn) {
  const started = Date.now()
  turn.state = state
  turn.controller = new AbortController()
  turn.inProgress = new Map()
  state.activeTurn = turn
  state.session.turnCount += 1
  turn.number = state.session.turnCount
  state.session.status = 'running'
  state.session.activeTurnId = turn.turnId
  const prompt = turn.displayText || turn.text
  if (!state.session.firstUserPrompt && prompt) {
    state.session.firstUserPrompt = prompt
    if (!state.session.title) state.session.title = prompt.slice(0, 40)
  }
  touch(state)
  viewNotify(state, 'turn/started', { turnId: turn.turnId, commandId: turn.commandId })
  viewNotify(state, 'session/statusChanged', { status: 'running' })
  userMessage(turn, turn.text, turn.displayText, turn.commandId)

  let terminal = 'completed'
  try {
    await runScenarios(turn, prompt)
    if (turn.error) terminal = 'failed'
  } catch (error) {
    if (turn.controller.signal.aborted) {
      terminal = 'cancelled'
    } else {
      log('turn failed', String(error?.stack ?? error))
      terminal = 'failed'
      turn.error = {
        kind: 'modelError',
        message: String(error?.message ?? error),
        retryable: false,
      }
    }
    for (const { item, text } of [...turn.inProgress.values()]) {
      completeItem(turn, item, {
        status: terminal === 'cancelled' ? 'cancelled' : 'failed',
        ...(item.kind === 'agentMessage' ? { text } : {}),
      })
    }
  }
  clearTimeout(turn.cancelTimer)

  const inputTokens = 10 + turn.text.length
  const outputTokens = Math.ceil((turn.replyLength ?? 0) / 4)
  state.usage = {
    promptTokens: state.usage.promptTokens + inputTokens,
    outputTokens: state.usage.outputTokens + outputTokens,
    totalTokens: state.usage.totalTokens + inputTokens + outputTokens,
  }
  const usage = { inputTokens, outputTokens, cachedTokens: 0, reasoningTokens: 0 }
  viewNotify(state, 'session/tokenUsage', {
    cumulative: { ...state.usage },
    modelId: state.session.modelId,
    promptTokens: inputTokens,
    totalTokens: inputTokens + outputTokens,
    turnId: turn.turnId,
    usage,
  })
  state.lastTurn = { turnId: turn.turnId, terminal, ...(turn.error ? { error: turn.error } : {}) }
  state.activeTurn = null
  state.session.status = 'idle'
  state.session.activeTurnId = null
  touch(state)
  persist(state)
  viewNotify(state, 'turn/completed', {
    turnId: turn.turnId,
    terminal,
    durationMs: Date.now() - started,
    usage,
    ...(turn.error ? { error: turn.error } : {}),
  })
  viewNotify(state, 'session/statusChanged', { status: 'idle' })
  listChanged(state)

  const next = state.queue.shift()
  if (next) launch(state, next)
}

// --- method handlers -----------------------------------------------------------------------

function pendingInput(state, userInputId) {
  const entry = state.userInputs.get(userInputId)
  if (entry) return entry
  if (state.settledInputs.has(userInputId))
    throw new RpcError('userInputAlreadySettled', 'This question was already settled', {
      userInputId,
    })
  throw new RpcError('userInputNotFound', 'No pending question with this id', { userInputId })
}

function settle(state, entry, request, answers, outcome, commandId) {
  const { userInputId } = entry.request
  state.userInputs.delete(userInputId)
  state.settledInputs.add(userInputId)
  request.after = () => {
    viewNotify(state, 'userInput/settled', settlement(answers, outcome, commandId, userInputId))
    entry.resolve({ outcome, answers })
  }
}

const handlers = {
  initialize(params) {
    if (initialized) throw new RpcError('alreadyInitialized', 'initialize was already called')
    initialized = true
    const requested = params?.capabilities?.requestedCapabilities
    return {
      experimentalApi: false,
      grantedCapabilities: Array.isArray(requested) ? requested : [],
      museHome: MUSE_HOME,
      platformFamily: process.platform === 'win32' ? 'windows' : 'unix',
      platformOs: process.platform,
      schema: { version: 1, fingerprint },
      serverInfo: { name: 'fake-muse', version: VERSION },
      sessionDurability: 'durable',
      userAgent: `fake-muse/${VERSION}`,
    }
  },

  'session/list'(params) {
    const limit = Math.min(200, Math.max(1, Number(params.limit) || 50))
    let offset = 0
    if (params.cursor) {
      try {
        offset = JSON.parse(Buffer.from(String(params.cursor), 'base64url').toString('utf8')).offset
      } catch {
        offset = -1
      }
      if (!Number.isInteger(offset) || offset < 0)
        throw new RpcError('invalidParams', 'Invalid session/list cursor')
    }
    const byId = new Map()
    let files = []
    try {
      files = readdirSync(STORE).filter((name) => name.endsWith('.json'))
    } catch {
      files = []
    }
    for (const name of files) {
      const record = readRecord(name.slice(0, -5))
      if (record?.session) byId.set(record.session.sessionId, { ...record.session })
    }
    for (const [sessionId, state] of loaded) byId.set(sessionId, { ...state.session })
    let sessions = [...byId.values()]
    if (typeof params.workspaceRoot === 'string')
      sessions = sessions.filter((session) => session.workspaceRoot === params.workspaceRoot)
    sessions.sort(
      (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.sessionId.localeCompare(b.sessionId),
    )
    const end = offset + limit
    return {
      sessions: sessions.slice(offset, end),
      nextCursor:
        end < sessions.length
          ? Buffer.from(JSON.stringify({ offset: end })).toString('base64url')
          : null,
    }
  },

  'model/list'(params) {
    const active = params.sessionId ? peekSession(params.sessionId).session.modelId : 'fake-fast'
    return {
      models: MODELS.map((model) => ({ ...model, isActive: model.modelId === active })),
      profileId: null,
      providerId: 'fake',
      source: 'fakeCatalog',
    }
  },

  'session/start'(params, request) {
    const workspaceRoot = params.workspaceRoot
    if (typeof workspaceRoot !== 'string' || !workspaceRoot)
      throw new RpcError('invalidParams', 'workspaceRoot is required')
    const modelId = params.modelId ?? 'fake-fast'
    if (!MODELS.some((model) => model.modelId === modelId))
      throw new RpcError('invalidParams', `Unknown model ${modelId}`)
    const state = stateFromRecord({
      session: newSession(workspaceRoot, modelId),
      items: [],
      viewEvents: 0,
    })
    loaded.set(state.session.sessionId, state)
    persist(state)
    request.after = () => notify('session/started', { session: { ...state.session } })
    return { session: { ...state.session }, viewCursor: cursorOf(state.viewSeq) }
  },

  'session/read'(params) {
    const state = peekSession(requireSessionId(params))
    return historyResult(state, { excludeItems: params.excludeItems === true })
  },

  'session/resume'(params) {
    const state = loadSession(requireSessionId(params))
    return historyResult(state, { excludeItems: params.excludeItems === true })
  },

  'view/subscribe'(params) {
    const state = loadedSession(requireSessionId(params))
    state.subscribed = true
    return { viewCursor: cursorOf(state.viewSeq) }
  },

  'view/unsubscribe'(params) {
    const state = loadedSession(requireSessionId(params))
    state.subscribed = false
    return {}
  },

  'view/page'(params) {
    const state = peekSession(requireSessionId(params))
    if ((params.direction ?? 'forward') !== 'forward')
      throw new RpcError('invalidParams', 'The fake CLI only pages forward')
    const limit = Math.min(1000, Math.max(1, Number(params.limit) || 100))
    let offset = 0
    if (params.cursor) {
      const match = /^page-(\d+)$/.exec(String(params.cursor))
      if (!match) throw new RpcError('invalidParams', 'Invalid view/page cursor')
      offset = Number(match[1])
    }
    // Item events are synthesized so the last item lands exactly on the session's head cursor.
    const items = state.items
    const head = state.viewSeq
    const events = items.slice(offset, offset + limit).map((item, index) => ({
      method: 'item/completed',
      params: {
        sessionId: state.session.sessionId,
        viewCursor: cursorOf(head - (items.length - 1 - (offset + index))),
        item: { ...item },
      },
    }))
    const end = offset + events.length
    return { events, nextCursor: end < items.length ? `page-${end}` : null }
  },

  'approval/listPending'(params) {
    const state = peekSession(requireSessionId(params))
    return {
      approvals: [...state.approvals.values()].map((entry) => ({ ...entry.request })),
      userInputs: [...state.userInputs.values()].map((entry) => ({ ...entry.request })),
    }
  },

  'turn/start'(params, request) {
    const state = loadedSession(requireSessionId(params))
    if (!Array.isArray(params.input)) throw new RpcError('invalidParams', 'input must be an array')
    const text = textOf(params.input)
    const hasImage = params.input.some((part) => part?.type === 'image')
    if (!text && !hasImage) throw new RpcError('invalidParams', 'input is empty')
    if (text.includes('[reject-send]')) throw new RpcError('invalidParams', 'Fake rejection')
    const displayText = typeof params.displayText === 'string' ? params.displayText : undefined
    const commandId = params.commandId
    const busy = state.activeTurn
    if (busy && params.ifBusy === 'steer') {
      request.after = () => userMessage(busy, text, displayText, commandId, { steered: true })
      return {
        commandId,
        disposition: 'steered',
        startedNewTurn: false,
        status: 'accepted',
        turnId: busy.turnId,
      }
    }
    const turn = {
      turnId: `turn-${randomUUID()}`,
      commandId,
      text,
      displayText,
      input: params.input,
      effort: params.reasoningEffort,
    }
    if (busy) {
      state.queue.push(turn)
      return {
        commandId,
        disposition: 'queued',
        startedNewTurn: false,
        status: 'accepted',
        turnId: turn.turnId,
      }
    }
    request.after = () => launch(state, turn)
    return {
      commandId,
      disposition: 'started',
      startedNewTurn: true,
      status: 'accepted',
      turnId: turn.turnId,
    }
  },

  'turn/cancel'(params) {
    const state = peekSession(requireSessionId(params))
    const turn = state.activeTurn
    if (!turn || (params.turnId && params.turnId !== turn.turnId))
      return { commandId: params.commandId, status: 'noop', turnId: state.lastTurn?.turnId ?? '' }
    turn.cancelTimer ??= setTimeout(
      () => turn.controller.abort(new Error('cancelled')),
      CANCEL_DELAY_MS,
    )
    return { commandId: params.commandId, status: 'accepted', turnId: turn.turnId }
  },

  'approval/decide'(params, request) {
    const state = loadedSession(requireSessionId(params))
    const approvalId = params.approvalId
    const entry = state.approvals.get(approvalId)
    if (!entry) {
      if (state.resolvedApprovals.has(approvalId))
        throw new RpcError('approvalAlreadyResolved', 'This approval was already resolved', {
          approvalId,
        })
      throw new RpcError('approvalNotFound', 'No pending approval with this id', { approvalId })
    }
    const choice = entry.request.availableChoices.find((c) => c.choiceId === params.choiceId)
    if (!choice)
      throw new RpcError('approvalChoiceInvalid', 'This choice is not available', {
        approvalId,
        choiceId: params.choiceId,
      })
    const current = entry.request.currentRequirementId
    if (
      params.requirementId?.approvalId !== current.approvalId ||
      params.requirementId?.sourceIndex !== current.sourceIndex
    )
      throw new RpcError('approvalRequirementStale', 'This approval changed. Review it again.', {
        approvalId,
        currentRequirementId: current,
      })
    state.approvals.delete(approvalId)
    state.resolvedApprovals.add(approvalId)
    request.after = () => {
      viewNotify(state, 'approval/resolved', {
        approvalId,
        decision: choice.decision,
        decidedAt: now(),
        decidedByCommandId: params.commandId,
        itemId: entry.request.itemId,
        policyResult: choice.decision === 'denied' ? 'deny' : 'allow',
        resolvedBy: 'user',
        stageEvidence: [],
        turnId: entry.turn.turnId,
      })
      entry.resolve(choice)
    }
    return { approvalId, commandId: params.commandId, status: 'accepted', terminal: true }
  },

  'userInput/answer'(params, request) {
    const state = loadedSession(requireSessionId(params))
    const entry = pendingInput(state, params.userInputId)
    const answers = Array.isArray(params.answers) ? params.answers : []
    for (const question of entry.request.questions) {
      const answer = answers.find((candidate) => candidate?.questionId === question.id)
      const labels = question.options.map((option) => option.label)
      const valid =
        answer &&
        ((typeof answer.selectedLabel === 'string' && labels.includes(answer.selectedLabel)) ||
          (Array.isArray(answer.selectedLabels) &&
            answer.selectedLabels.every((label) => labels.includes(label))) ||
          (typeof answer.freeText === 'string' && answer.freeText.length <= 500))
      if (!valid)
        throw new RpcError(
          'userInputAnswerInvalid',
          `Question ${question.id} has no valid answer`,
          {
            userInputId: params.userInputId,
          },
        )
    }
    settle(state, entry, request, answers, 'answered', params.commandId)
    return { commandId: params.commandId, status: 'accepted', userInputId: params.userInputId }
  },

  'userInput/cancel'(params, request) {
    const state = loadedSession(requireSessionId(params))
    const entry = pendingInput(state, params.userInputId)
    settle(state, entry, request, [], 'cancelled', params.commandId)
    return { commandId: params.commandId, status: 'accepted', userInputId: params.userInputId }
  },

  'item/readOutput'(params) {
    const state = peekSession(requireSessionId(params))
    const item = state.items.find((entry) => entry.itemId === params.itemId)
    if (!item) throw new RpcError('notFound', 'Item not found', { itemId: params.itemId })
    if (!item.outputRef || item.outputRef.id !== params.outputRef)
      throw new RpcError('outputUnavailable', 'This item has no stored output', {
        itemId: params.itemId,
        outputRef: String(params.outputRef),
      })
    const total = bigText()
    const offset = Math.max(0, Number(params.offsetBytes) || 0)
    const length = Math.max(0, Number(params.lengthBytes) || 64 * 1024)
    const content = total.slice(offset, offset + length)
    return {
      byteLen: total.length,
      content,
      encoding: 'utf8',
      eof: offset + content.length >= total.length,
      mediaType: 'text/plain',
      offsetBytes: offset,
    }
  },

  'session/rename'(params, request) {
    const state = loadedSession(requireSessionId(params))
    // The real CLI returns a canonical (normalized, lowercase) name; mirror that observable behavior.
    const name = typeof params.name === 'string' ? params.name.trim().toLowerCase() : ''
    if (!name) throw new RpcError('invalidParams', 'name is required')
    state.session.name = name
    touch(state)
    persist(state)
    request.after = () => {
      viewNotify(state, 'session/nameChanged', { name, nameOrigin: 'user' })
      listChanged(state)
    }
    return { commandId: params.commandId, name, status: 'accepted' }
  },

  'session/setModel'(params) {
    const state = loadedSession(requireSessionId(params))
    const modelId = params.model?.modelId
    if (!MODELS.some((model) => model.modelId === modelId))
      throw new RpcError('invalidParams', `Unknown model ${String(modelId)}`)
    state.session.modelId = modelId
    touch(state)
    persist(state)
    return { commandId: params.commandId, status: 'accepted' }
  },

  'session/compact'(params) {
    loadedSession(requireSessionId(params))
    return { commandId: params.commandId, status: 'noop', reason: 'Nothing to compact' }
  },

  'hook/list'(params) {
    peekSession(requireSessionId(params))
    return { hooks: [] }
  },

  'skill/list'(params) {
    peekSession(requireSessionId(params))
    return { skills: [] }
  },
}

function handleLine(line) {
  if (!line.trim()) return
  let message
  try {
    message = JSON.parse(line)
  } catch {
    log('ignoring a non-JSON input line')
    return
  }
  if (typeof message?.method !== 'string') return // No server requests are sent, so no responses.
  if (env.FAKE_MUSE_LOG) {
    try {
      appendFileSync(env.FAKE_MUSE_LOG, `${message.method}\n`)
    } catch (error) {
      log('could not write FAKE_MUSE_LOG', String(error))
    }
  }
  if (message.id === undefined || message.id === null) return // e.g. `initialized`
  const request = { after: undefined }
  try {
    const handler = Object.hasOwn(handlers, message.method) ? handlers[message.method] : undefined
    if (!handler) throw new RpcError('methodNotFound', `Method not found: ${message.method}`)
    if (!initialized && message.method !== 'initialize')
      throw new RpcError('notInitialized', 'initialize must be called first')
    const params = message.params && typeof message.params === 'object' ? message.params : {}
    const result = handler(params, request)
    out({ jsonrpc: '2.0', id: message.id, result })
    // Follow-up notifications (turn events, resolutions) are only emitted after the ack.
    request.after?.()
  } catch (error) {
    const rpc =
      error instanceof RpcError ? error : new RpcError('internal', String(error?.message ?? error))
    if (!(error instanceof RpcError)) log('internal error', String(error?.stack ?? error))
    out({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: rpc.code, message: rpc.message, data: rpc.data },
    })
  }
}

async function serve() {
  if (env.FAKE_MUSE_FAIL_INITIALIZE === '1') {
    process.stderr.write('fake-muse: refusing to start (FAKE_MUSE_FAIL_INITIALIZE=1)\n')
    process.exit(3)
  }
  // Nothing but JSON lines may reach stdout.
  console.log = console.error
  console.info = console.error
  console.debug = console.error
  try {
    const sdk = await import('@muse-code/sdk')
    if (typeof sdk.EXPECTED_SCHEMA_FINGERPRINT === 'string')
      fingerprint = sdk.EXPECTED_SCHEMA_FINGERPRINT
  } catch {
    // The SDK is optional here; keep the pinned fallback fingerprint.
  }
  mkdirSync(STORE, { recursive: true })
  process.stdout.on('error', () => process.exit(0))
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  lines.on('line', handleLine)
  lines.on('close', () => process.exit(0))
}

// ---------------------------------------------------------------------------------------------

const [command, ...rest] = process.argv.slice(2)
if (command === '--version') {
  process.stdout.write(`Muse Code ${VERSION} (deterministic test fixture)\n`)
} else if (command === 'voice') {
  await voice(rest)
} else if (command === 'seed') {
  seed(rest)
} else if (command === 'serve') {
  await serve()
} else {
  process.stderr.write(
    'fake-muse usage: muse --version | serve [--trust-workspace] [--provider echo] | voice transcribe <file> | seed <workspaceRoot> <itemCount> [title]\n',
  )
  process.exit(2)
}
