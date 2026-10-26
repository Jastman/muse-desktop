// Exercises the deterministic fake Muse CLI (tests/fixtures/fake-muse) through the real MuseHost.
// This is a test double for the MSP wire protocol, not an integration test of the real CLI.
import { execFile, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { MspError } from '@muse-code/sdk'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MuseHost } from '../../src/main/muse-host'
import type { AppEvent, SessionView } from '../../src/shared/protocol'

const fixtureDir = fileURLToPath(new URL('../fixtures/fake-muse/', import.meta.url))
const script = join(fixtureDir, 'fake-muse.mjs')
const cli = join(fixtureDir, process.platform === 'win32' ? 'muse.cmd' : 'muse')
// 1x1 transparent PNG.
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

const variables = [
  'MUSE_HOME',
  'FAKE_MUSE_NODE',
  'FAKE_MUSE_STREAM_DELAY_MS',
  'FAKE_MUSE_LOG',
  'FAKE_MUSE_FAIL_INITIALIZE',
] as const
const saved = Object.fromEntries(variables.map((name) => [name, process.env[name]]))
let root: string
let workspace: string
let logPath: string
let host: MuseHost | undefined
let events: AppEvent[]

const wait = { timeout: 10_000, interval: 20 }
const execFileAsync = promisify(execFile)

function connectHost() {
  events = []
  host = new MuseHost((event) => events.push(event))
  return host.connect(cli)
}
function requireHost() {
  if (!host) throw new Error('host not connected')
  return host
}
function agentText(view: SessionView) {
  return view.items
    .filter((item) => item.kind === 'agentMessage')
    .map((item) => item.text ?? '')
    .join('\n')
}
async function sendText(sessionId: string, text: string, extra: Record<string, unknown>[] = []) {
  await requireHost().send(sessionId, [{ type: 'text', text }, ...extra], 'medium', 'queue', text)
}
async function waitForIdleReply(sessionId: string, expected: string) {
  await vi.waitFor(() => {
    const view = requireHost().getView(sessionId)
    expect(agentText(view)).toContain(expected)
    expect(view.session.status).toBe('idle')
  }, wait)
  return requireHost().getView(sessionId)
}
async function turnStarts() {
  const log = await readFile(logPath, 'utf8').catch(() => '')
  return log.split(/\r?\n/).filter((line) => line === 'turn/start').length
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'fake-muse-test-'))
  workspace = join(root, 'workspace')
  await mkdir(workspace)
  logPath = join(root, 'methods.log')
  // discoverCli merges the login-shell environment over process.env; these are inherited
  // unless the login shell itself exports them.
  process.env.MUSE_HOME = join(root, 'home')
  process.env.FAKE_MUSE_NODE = process.execPath
  process.env.FAKE_MUSE_STREAM_DELAY_MS = '2'
  process.env.FAKE_MUSE_LOG = logPath
  delete process.env.FAKE_MUSE_FAIL_INITIALIZE
})

beforeEach(() => {
  events = []
})

afterEach(async () => {
  await host?.close()
  host = undefined
  delete process.env.FAKE_MUSE_FAIL_INITIALIZE
})

afterAll(async () => {
  for (const name of variables) {
    if (saved[name] === undefined) delete process.env[name]
    else process.env[name] = saved[name]
  }
  await rm(root, { recursive: true, force: true })
})

describe('fake Muse CLI fixture', { timeout: 20_000 }, () => {
  it('connects, lists models, and streams an echo reply', async () => {
    const status = await connectHost()
    expect(status.state).toBe('ready')
    expect(status.version).toContain('0.0.0-fake')
    expect(status.fingerprintWarning).toBeUndefined()
    const created = await requireHost().create(workspace)
    expect(created.session.workspaceRoot).toBe(workspace)
    const models = await requireHost().models(created.session.sessionId)
    expect(models.map((model) => model.modelId)).toEqual(['fake-fast', 'fake-unknown-effort'])
    expect(models[0].isActive).toBe(true)

    await sendText(created.session.sessionId, 'hello')
    const view = await waitForIdleReply(created.session.sessionId, 'Echo: hello')
    expect(view.items.map((item) => item.kind)).toEqual(['userMessage', 'agentMessage'])
    expect(view.items[1].status).toBe('completed')
    expect(view.usage?.total).toBeGreaterThan(0)
    const listed = await requireHost().list()
    expect(listed.sessions.map((session) => session.sessionId)).toContain(created.session.sessionId)
  })

  it('reports image bytes and rejects [reject-send] without starting a turn', async () => {
    await connectHost()
    const { session } = await requireHost().create(workspace)
    const bytes = Buffer.from(png, 'base64').length
    await sendText(session.sessionId, 'see image', [
      { type: 'image', mediaType: 'image/png', base64Data: png },
    ])
    await waitForIdleReply(session.sessionId, `Received image image/png (${bytes} bytes)`)

    const rejected = await sendText(session.sessionId, '[reject-send] nope').catch((e) => e)
    expect(rejected).toBeInstanceOf(MspError)
    expect((rejected as MspError).kind).toBe('invalidParams')
    expect(requireHost().getView(session.sessionId).items).toHaveLength(2)
  })

  it('surfaces malformed frames as errors and still finishes the reply', async () => {
    await connectHost()
    const { session } = await requireHost().create(workspace)
    await sendText(session.sessionId, '[malformed] check')
    await waitForIdleReply(session.sessionId, 'Echo: [malformed] check')
    expect(events.some((event) => event.type === 'error')).toBe(true)
  })

  it('waits for an approval and completes the tool after approving once', async () => {
    await connectHost()
    const { session } = await requireHost().create(workspace)
    await sendText(session.sessionId, '[approval] run tests')
    await vi.waitFor(() => {
      expect(requireHost().getView(session.sessionId).approvals).toHaveLength(1)
    }, wait)
    const [approval] = requireHost().getView(session.sessionId).approvals
    expect(approval.subject.command).toBe('npm test')
    await requireHost().approve(session.sessionId, approval.approvalId, 'once')
    const view = await waitForIdleReply(session.sessionId, 'Approved')
    expect(view.approvals).toHaveLength(0)
    const tool = view.items.find((item) => item.kind === 'toolCall')
    expect(tool).toMatchObject({ status: 'completed', visibleOutput: 'All 3 tests passed' })
  })

  it('cancels a slow turn after a visible stopping window', async () => {
    await connectHost()
    const { session } = await requireHost().create(workspace)
    await sendText(session.sessionId, '[slow] long answer')
    await vi.waitFor(() => {
      expect(agentText(requireHost().getView(session.sessionId)).length).toBeGreaterThan(0)
    }, wait)
    await requireHost().cancel(session.sessionId)
    expect(requireHost().getView(session.sessionId).session.status).toBe('running')
    await vi.waitFor(() => {
      const view = requireHost().getView(session.sessionId)
      expect(view.session.status).toBe('idle')
      expect(view.items.find((item) => item.kind === 'agentMessage')?.status).toBe('cancelled')
    }, wait)
  })

  it('keeps durable history across reconnects without replaying sends', async () => {
    await connectHost()
    const { session } = await requireHost().create(workspace)
    await sendText(session.sessionId, 'remember me')
    await waitForIdleReply(session.sessionId, 'Echo: remember me')
    const startsBefore = await turnStarts()

    expect((await requireHost().connect(cli)).state).toBe('ready')
    const reopened = await requireHost().open(session.sessionId, true)
    expect(agentText(reopened)).toContain('Echo: remember me')
    expect(await turnStarts()).toBe(startsBefore)

    await sendText(session.sessionId, 'again')
    await waitForIdleReply(session.sessionId, 'Echo: again')
    expect(await turnStarts()).toBe(startsBefore + 1)
  })

  it('reports a closed connection when the CLI crashes mid-stream', async () => {
    await connectHost()
    const { session } = await requireHost().create(workspace)
    await sendText(session.sessionId, '[crash] boom')
    await vi.waitFor(() => {
      expect(requireHost().status.state).toBe('error')
      expect(requireHost().status.message).toMatch(/connection closed/)
    }, wait)

    expect((await requireHost().connect(cli)).state).toBe('ready')
    const reopened = await requireHost().open(session.sessionId, true)
    expect(reopened.items.map((item) => item.kind)).toEqual(['userMessage'])
  })

  it('pages a 3000-item seeded session through view/page', async () => {
    const sessionId = execFileSync(process.execPath, [script, 'seed', workspace, '3000', 'Bench'], {
      encoding: 'utf8',
      env: process.env,
    }).trim()
    await connectHost()
    const view = await requireHost().open(sessionId)
    expect(view.items).toHaveLength(3000)
    expect(view.items[0].text).toBe('Synthetic message 1 about topic-1')
    expect(view.items[2999].kind).toBe('agentMessage')
    expect(view.historyNotice).toBeUndefined()
  })

  it('fails to connect when the CLI exits before the handshake', async () => {
    process.env.FAKE_MUSE_FAIL_INITIALIZE = '1'
    const status = await connectHost()
    expect(status.state).toBe('error')
  })

  it('transcribes voice through the voice subcommand', async () => {
    const recording = join(root, 'recording.wav')
    await writeFile(recording, Buffer.from('RIFF'))
    const { stdout } = await execFileAsync(process.execPath, [
      script,
      'voice',
      'transcribe',
      recording,
    ])
    expect(stdout.trim()).toBe('Fake transcription')
  })
})
