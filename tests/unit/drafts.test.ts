import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DraftStore } from '../../src/main/drafts'

let directory: string
let path: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'muse-drafts-'))
  path = join(directory, 'drafts.json')
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

const draft = (text: string, extra = {}) => ({ text, attachments: [], ...extra })

describe('durable drafts', () => {
  it('survives a restart with text, mode and attachment metadata only', async () => {
    const store = new DraftStore({ path, persistDelayMs: 5 })
    await store.set(
      'session:abc',
      draft('<div>keep my markup</div>', {
        mode: 'steer',
        attachments: [{ name: 'shot.png', kind: 'image', size: 10 }],
      }),
    )
    await store.set('new:/work/project', draft('new project idea'))
    await store.flush()
    const raw = await readFile(path, 'utf8')
    expect(raw).not.toContain('base64')
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)

    const restored = new DraftStore({ path })
    await restored.load()
    expect(restored.get('session:abc')).toMatchObject({
      text: '<div>keep my markup</div>',
      mode: 'steer',
      attachments: [{ name: 'shot.png', kind: 'image', size: 10 }],
    })
    expect(restored.get('new:/work/project')?.text).toBe('new project idea')
  })

  it('keeps conversations isolated and deletes empty drafts', async () => {
    const store = new DraftStore({ path, persistDelayMs: 5 })
    await store.set('session:a', draft('alpha'))
    await store.set('session:b', draft('beta'))
    await store.set('session:a', draft('   '))
    await store.flush()
    expect(store.get('session:a')).toBeUndefined()
    expect(store.get('session:b')?.text).toBe('beta')
  })

  it('rejects unknown key shapes', () => {
    const store = new DraftStore({ path })
    expect(() => store.set('../../etc/passwd', draft('x'))).toThrow()
    expect(() => store.set('session:../x/y', draft('x'))).toThrow()
  })

  it('persists a sending marker immediately so a restart can warn instead of resending', async () => {
    const store = new DraftStore({ path, persistDelayMs: 60_000 })
    await store.set('session:a', draft('run the migration', { sendState: 'sending' }), true)
    const restored = new DraftStore({ path })
    await restored.load()
    expect(restored.get('session:a')?.sendState).toBe('sending')
  })

  it('bounds entries and age', async () => {
    let now = Date.parse('2026-01-01T00:00:00Z')
    const store = new DraftStore({ path, maxEntries: 3, maxAgeMs: 1000, now: () => now })
    for (const id of ['a', 'b', 'c', 'd']) {
      now += 10
      await store.set(`session:${id}`, draft(id))
    }
    expect(store.list().map((entry) => entry.key)).toEqual(['session:b', 'session:c', 'session:d'])
    now += 5000
    expect(store.list()).toEqual([])
  })

  it('sets aside unreadable and unsupported files instead of failing', async () => {
    await writeFile(path, '{nope')
    const broken = new DraftStore({ path })
    await broken.load()
    expect(broken.notice).toContain('could not be read')
    expect((await readdir(directory)).some((name) => name.includes('unreadable'))).toBe(true)

    await writeFile(path, JSON.stringify({ schemaVersion: 9, drafts: {} }))
    const future = new DraftStore({ path })
    await future.load()
    expect(future.notice).toContain('unsupported')
  })

  it('drops individually invalid entries and entries stored under the wrong key', async () => {
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        drafts: {
          'session:a': {
            key: 'session:a',
            text: 'ok',
            updatedAt: new Date().toISOString(),
            attachments: [],
          },
          'session:b': {
            key: 'session:c',
            text: 'moved',
            updatedAt: new Date().toISOString(),
            attachments: [],
          },
          'session:d': { key: 'session:d', text: 5 },
        },
      }),
    )
    const store = new DraftStore({ path })
    await store.load()
    expect(store.list().map((entry) => entry.key)).toEqual(['session:a'])
  })

  it('clears selected or all drafts', async () => {
    const store = new DraftStore({ path, persistDelayMs: 5 })
    await store.set('session:a', draft('a'), true)
    await store.set('session:b', draft('b'), true)
    await store.clear(['session:a'])
    expect(store.list().map((entry) => entry.key)).toEqual(['session:b'])
    await store.clear()
    expect(await readdir(directory)).toEqual([])
  })
})
