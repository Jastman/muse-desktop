import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HistorySearchService } from '../../src/main/history-search'
import type { MuseSession, TranscriptItem } from '../../src/shared/protocol'

const session = (sessionId: string, updatedAt = '2026-01-01T00:00:00Z') =>
  ({
    sessionId,
    workspaceRoot: '/work/app',
    createdAt: updatedAt,
    updatedAt,
    status: 'idle',
    activeTurnId: null,
    title: `Session ${sessionId}`,
  }) as MuseSession
const message = (itemId: string, text: string) =>
  ({ itemId, kind: 'agentMessage', revision: 1, status: 'completed', text }) as TranscriptItem

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function setup(overrides: { enabled?: boolean; connected?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'muse-history-'))
  dirs.push(dir)
  const state = { enabled: overrides.enabled ?? true, connected: overrides.connected ?? true }
  const sessions = [session('s1'), session('s2')]
  const reads: string[] = []
  const statuses: unknown[] = []
  const service = new HistorySearchService({
    path: join(dir, 'index.json'),
    yieldMs: 0,
    enabled: () => state.enabled,
    connected: () => state.connected,
    onStatus: (status) => statuses.push(status),
    source: {
      listPage: async () => ({ sessions, nextCursor: null }),
      readSession: async (id) => {
        reads.push(id)
        return { items: [message(`${id}-m`, `needle in ${id}`)], partial: false }
      },
    },
  })
  await service.load()
  return { service, state, reads, statuses, sessions, dir }
}

const query = { text: 'needle', includeArchived: false, offset: 0, limit: 25 }

async function settle(service: HistorySearchService) {
  await vi.waitFor(() => expect(service.status().coverage.building).toBe(false))
}

describe('HistorySearchService', () => {
  it('refuses to search or rebuild when disabled, and to rebuild when disconnected', async () => {
    const { service, state } = await setup({ enabled: false })
    expect(() => service.search(query, [])).toThrow(/turned off/)
    await expect(service.rebuild()).rejects.toThrow(/turned off/)
    state.enabled = true
    state.connected = false
    await expect(service.rebuild()).rejects.toThrow(/Connect/)
    await service.close()
  })

  it('indexes via read-only history and only re-reads changed sessions', async () => {
    const { service, reads, sessions } = await setup()
    await service.rebuild()
    await vi.waitFor(() => expect(service.status().coverage.indexedSessions).toBe(2))
    await settle(service)
    expect(service.search(query, []).total).toBe(2)
    expect(service.search(query, ['s1']).hits.map((hit) => hit.sessionId)).toEqual(['s2'])
    reads.length = 0
    sessions[0] = session('s1', '2026-02-01T00:00:00Z')
    service.schedule(0)
    await vi.waitFor(() => expect(reads).toEqual(['s1']))
    await settle(service)
    await service.close()
  })

  it('deletes the index when turned off and reports status', async () => {
    const { service, state, statuses, dir } = await setup()
    await service.rebuild()
    await vi.waitFor(() => expect(service.status().coverage.indexedSessions).toBe(2))
    await settle(service)
    await service.index.flush()
    state.enabled = false
    await service.setEnabled(false)
    expect(service.status().coverage.indexedSessions).toBe(0)
    expect(service.status().enabled).toBe(false)
    await expect(stat(join(dir, 'index.json'))).rejects.toThrow()
    expect(statuses.length).toBeGreaterThan(0)
    await service.close()
  })

  it('does not build while disconnected', async () => {
    const { service, reads } = await setup({ connected: false })
    service.schedule(0)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(reads).toEqual([])
    await service.close()
  })
})
