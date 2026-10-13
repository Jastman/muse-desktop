import assert from 'node:assert/strict'
import { MspError } from '@muse-code/sdk'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MuseHost } from '../src/main/muse-host'
import type { AppEvent, SessionView } from '../src/shared/protocol'
import { discoverCli } from '../src/main/cli'

const binary = (await discoverCli(process.env.MUSE_BIN)).path
const temporary = await realpath(await mkdtemp(join(tmpdir(), 'muse-desktop-protocol-')))
const project = join(temporary, 'project')
await mkdir(project)
const original = { ...process.env }
Object.assign(process.env, {
  HOME: temporary,
  MUSE_HOME: join(temporary, 'muse'),
  XDG_CONFIG_HOME: join(temporary, 'config'),
  XDG_DATA_HOME: join(temporary, 'data'),
  XDG_STATE_HOME: join(temporary, 'state'),
  MUSE_DESKTOP_TEST_PROVIDER: 'echo',
})
const updates: SessionView[] = []
const errors: string[] = []
let changed: (() => void) | undefined
const host = new MuseHost((event: AppEvent) => {
  if (event.type === 'session') {
    updates.push(event.view)
    changed?.()
  }
  if (event.type === 'error') errors.push(event.message)
})

async function waitFor(check: () => boolean) {
  if (check()) return
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      changed = undefined
      reject(new Error('Timed out waiting for a protocol update.'))
    }, 15000)
    changed = () => {
      if (check()) {
        clearTimeout(timer)
        changed = undefined
        resolve()
      }
    }
  })
}

try {
  const status = await host.connect(binary)
  assert.equal(status.state, 'ready', status.message || 'Muse should connect')
  console.log(`PASS · Connected to Muse Code ${status.version}`)
  const started = await host.create(project)
  const sessionId = started.session.sessionId
  assert.equal(started.session.workspaceRoot, project)
  await host.send(
    sessionId,
    [{ type: 'text', text: 'Hello, Muse Desktop.' }],
    'high',
    'queue',
    'Hello, Muse Desktop.',
  )
  await waitFor(() =>
    updates.some(
      (view) =>
        view.session.status === 'idle' &&
        view.items.some((item) => item.kind === 'agentMessage' && item.status === 'completed'),
    ),
  )
  const completed = host.getView(sessionId)
  assert(
    completed.items.some((item) => item.kind === 'userMessage' && item.text?.includes('Hello')),
  )
  assert(
    completed.items.some((item) => item.kind === 'agentMessage' && item.text?.includes('Hello')),
  )
  assert.equal(completed.session.status, 'idle')
  console.log('PASS · Real CLI session creation, streamed turn, and completion')
  await host.rename(sessionId, 'desktop integration check')
  const listed = await host.list()
  assert(listed.sessions.some((session) => session.sessionId === sessionId))
  await host.close()
  assert.equal((await host.connect(binary)).state, 'ready')
  const reopened = await host.open(sessionId)
  assert.equal(reopened.session.name, 'desktop integration check')
  assert(
    reopened.items.some((item) => item.kind === 'agentMessage' && item.text?.includes('Hello')),
  )
  console.log('PASS · Rename, list, host restart, and durable transcript recovery')
  updates.length = 0
  await host.send(
    sessionId,
    [{ type: 'text', text: 'A second turn after reconnect.' }],
    'high',
    'queue',
    'A second turn after reconnect.',
  )
  await waitFor(() =>
    updates.some(
      (view) =>
        view.session.status === 'idle' &&
        view.items.some(
          (item) =>
            item.kind === 'agentMessage' &&
            item.status === 'completed' &&
            item.text?.includes('second turn'),
        ),
    ),
  )
  assert.equal(
    host.getView(sessionId).items.filter((item) => item.kind === 'userMessage').length,
    2,
  )
  assert.deepEqual(errors, [])
  console.log('PASS · Resume, second turn, no duplicate history or protocol errors')
  await assert.rejects(
    host.compact(sessionId),
    (error: unknown) =>
      error instanceof MspError &&
      error.kind === 'commandRejected' &&
      error.data.reason === 'compaction_unavailable',
  )
  console.log('PASS · Echo provider reports unsupported compaction without claiming success')
} finally {
  await host.close()
  process.env = original
  await rm(temporary, { recursive: true, force: true })
}
