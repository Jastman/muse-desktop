import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  IndexBuilder,
  SearchIndex,
  type IndexedSessionMeta,
  type IndexSource,
  type SearchQuery,
} from '../../src/main/search-index'
import type { MuseSession, TranscriptItem } from '../../src/shared/protocol'

let temporary: string
beforeEach(async () => {
  const base = join(process.cwd(), 'node_modules', '.cache')
  await mkdir(base, { recursive: true })
  temporary = await mkdtemp(join(base, 'search-index-test-'))
})
afterEach(async () => {
  await rm(temporary, { recursive: true, force: true })
})

let counter = 0
function item(kind: string, fields: Partial<TranscriptItem> = {}): TranscriptItem {
  counter++
  return { itemId: `i${counter}`, kind, revision: 1, status: 'completed', ...fields }
}
const user = (text: string, fields: Partial<TranscriptItem> = {}) =>
  item('userMessage', { text, ...fields })
const agent = (text: string, fields: Partial<TranscriptItem> = {}) =>
  item('agentMessage', { text, ...fields })

function meta(sessionId: string, fields: Partial<IndexedSessionMeta> = {}): IndexedSessionMeta {
  return {
    sessionId,
    title: `Title ${sessionId}`,
    workspaceRoot: '/work/a',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...fields,
  }
}

function query(text: string, fields: Partial<SearchQuery> = {}): SearchQuery {
  return { text, includeArchived: false, archivedIds: [], offset: 0, limit: 50, ...fields }
}

function makeIndex(options: Partial<ConstructorParameters<typeof SearchIndex>[0]> = {}) {
  return new SearchIndex({
    path: join(temporary, 'index.json'),
    persistDelayMs: 60_000,
    ...options,
  })
}

function highlighted(hit: { snippet: string; highlights: [number, number][] }): string[] {
  return hit.highlights.map(([a, b]) => hit.snippet.slice(a, b))
}

describe('SearchIndex search', () => {
  it('indexes and finds user, assistant and tool items', () => {
    const index = makeIndex()
    index.upsert(meta('s1'), [
      user('How do I configure the router?'),
      agent('Edit the router config file.'),
      item('toolCall', {
        tool: 'bash',
        commandText: 'cat router.toml',
        visibleOutput: 'secret huge output',
      }),
      item('reasoning', { text: 'thinking about router internals' }),
    ])
    const result = index.search(query('router'))
    expect(result.total).toBe(3)
    expect(result.hits.map((hit) => hit.role)).toEqual(['user', 'assistant', 'tool'])
    expect(index.search(query('internals')).total).toBe(0)
    expect(index.search(query('huge')).total).toBe(0)
    expect(result.coverage.indexedSessions).toBe(1)
    expect(result.coverage.indexedItems).toBe(3)
  })

  it('requires all terms (AND) and supports quoted phrases', () => {
    const index = makeIndex()
    index.upsert(meta('s1'), [
      agent('the quick brown fox'),
      agent('quick red fox'),
      agent('brown dog'),
    ])
    expect(index.search(query('quick fox')).total).toBe(2)
    expect(index.search(query('quick brown')).total).toBe(1)
    expect(index.search(query('"quick fox"')).total).toBe(0)
    expect(index.search(query('"brown fox"')).total).toBe(1)
    expect(index.search(query('"red fox" quick')).total).toBe(1)
    expect(index.search(query('   ')).total).toBe(0)
  })

  it('is accent- and case-insensitive with correct highlights on original text', () => {
    const index = makeIndex()
    index.upsert(meta('s1'), [agent('Meet at the Café Crème tonight')])
    const result = index.search(query('cafe creme'))
    expect(result.total).toBe(1)
    expect(highlighted(result.hits[0])).toEqual(['Café', 'Crème'])
    const decomposed = index.search(query('CAFE\u0301'))
    expect(decomposed.total).toBe(1)
    expect(highlighted(decomposed.hits[0])).toEqual(['Café'])
  })

  it('indexes displayText instead of text for user messages', () => {
    const index = makeIndex()
    index.upsert(meta('s1'), [
      user('<context>injected-metadata secretpath</context> fix the bug', {
        displayText: 'fix the bug',
      }),
      user('plain message only'),
    ])
    expect(index.search(query('injected')).total).toBe(0)
    expect(index.search(query('secretpath')).total).toBe(0)
    expect(index.search(query('bug')).hits[0].snippet).toBe('fix the bug')
    expect(index.search(query('plain')).total).toBe(1)
  })

  it('filters by project, dates and archived state', () => {
    const index = makeIndex()
    index.upsert(meta('a', { workspaceRoot: '/work/a', updatedAt: '2026-03-10T00:00:00.000Z' }), [
      agent('alpha deploy', { recordedAt: '2026-03-01T12:00:00.000Z' }),
      agent('alpha deploy later'),
    ])
    index.upsert(meta('b', { workspaceRoot: '/work/b', updatedAt: '2026-02-01T00:00:00.000Z' }), [
      agent('beta deploy'),
    ])
    expect(
      index.search(query('deploy', { project: '/work/b' })).hits.map((h) => h.sessionId),
    ).toEqual(['b'])
    expect(index.search(query('deploy', { project: null })).total).toBe(3)

    const march = index.search(query('deploy', { from: '2026-03-01T00:00:00.000Z' }))
    expect(march.total).toBe(2)
    const early = index.search(
      query('deploy', { from: '2026-03-01T00:00:00.000Z', to: '2026-03-05T23:59:59.999Z' }),
    )
    expect(early.hits.map((h) => h.recordedAt)).toEqual(['2026-03-01T12:00:00.000Z'])
    expect(
      index.search(query('deploy', { to: '2026-02-15T00:00:00.000Z' })).hits[0].sessionId,
    ).toBe('b')

    expect(index.search(query('deploy', { archivedIds: ['a'] })).total).toBe(1)
    const withArchived = index.search(
      query('deploy', { archivedIds: ['a'], includeArchived: true }),
    )
    expect(withArchived.total).toBe(3)
    expect(withArchived.hits.map((h) => [h.sessionId, h.archived])).toEqual([
      ['a', true],
      ['a', true],
      ['b', false],
    ])
  })

  it('paginates with exact totals, nextOffset and no overlap', () => {
    const index = makeIndex()
    for (let s = 0; s < 5; s++) {
      index.upsert(
        meta(`s${s}`, { updatedAt: `2026-01-0${s + 1}T00:00:00.000Z` }),
        Array.from({ length: 5 }, (_, i) => agent(`needle ${s}-${i}`)),
      )
    }
    const seen: string[] = []
    let offset: number | null = 0
    let pages = 0
    while (offset !== null) {
      const page = index.search(query('needle', { offset, limit: 7 }))
      expect(page.total).toBe(25)
      expect(page.hits.length).toBeLessThanOrEqual(7)
      seen.push(...page.hits.map((hit) => hit.itemId))
      offset = page.nextOffset
      pages++
    }
    expect(pages).toBe(4)
    expect(new Set(seen).size).toBe(25)
    const first = index.search(query('needle', { limit: 1000 }))
    expect(first.hits).toHaveLength(25)
    expect(first.hits[0].sessionId).toBe('s4')
    expect(first.hits[0].snippet).toBe('needle 4-0')
    expect(index.search(query('needle', { offset: 25 })).hits).toEqual([])
  })

  it('builds windowed snippets with ellipses and highlight ranges', () => {
    const index = makeIndex()
    const text = `${'lorem '.repeat(40)}   the   Target word  ${'ipsum '.repeat(40)}`
    index.upsert(meta('s1'), [agent(text)])
    const hit = index.search(query('target')).hits[0]
    expect(hit.snippet.startsWith('…')).toBe(true)
    expect(hit.snippet.endsWith('…')).toBe(true)
    expect(hit.snippet).toContain('the Target word')
    expect(hit.snippet.length).toBeLessThanOrEqual(162)
    expect(highlighted(hit)).toEqual(['Target'])
  })

  it('truncates long items and marks the session partial', () => {
    const index = makeIndex({ maxCharsPerItem: 50 })
    index.upsert(meta('s1'), [agent(`${'a'.repeat(60)} hidden`), agent('short visible')])
    expect(index.search(query('hidden')).total).toBe(0)
    expect(index.search(query('visible')).total).toBe(1)
    expect(index.coverage().partialSessions).toBe(1)
  })

  it('keeps the newest items when a session exceeds maxItemsPerSession', () => {
    const index = makeIndex({ maxItemsPerSession: 2 })
    index.upsert(meta('s1'), [agent('first'), agent('second'), agent('third')])
    expect(index.search(query('first')).total).toBe(0)
    expect(index.search(query('third')).total).toBe(1)
    expect(index.coverage()).toMatchObject({ partialSessions: 1, indexedItems: 2 })
  })

  it('evicts least-recently-updated sessions over maxSessions', () => {
    const index = makeIndex({ maxSessions: 2 })
    index.setKnownSessions(3)
    index.upsert(meta('old', { updatedAt: '2026-01-01T00:00:00.000Z' }), [agent('shared')])
    index.upsert(meta('mid', { updatedAt: '2026-01-02T00:00:00.000Z' }), [agent('shared')])
    index.upsert(meta('new', { updatedAt: '2026-01-03T00:00:00.000Z' }), [agent('shared')])
    const result = index.search(query('shared'))
    expect(result.hits.map((hit) => hit.sessionId)).toEqual(['new', 'mid'])
    expect(result.coverage).toMatchObject({ indexedSessions: 2, knownSessions: 3 })
    expect(index.needsIndex({ sessionId: 'old', updatedAt: '2026-01-01T00:00:00.000Z' })).toBe(
      false,
    )
    expect(index.needsIndex({ sessionId: 'old', updatedAt: '2026-01-05T00:00:00.000Z' })).toBe(true)
  })

  it('evicts over maxTotalChars', () => {
    const index = makeIndex({ maxTotalChars: 15 })
    index.upsert(meta('old', { updatedAt: '2026-01-01T00:00:00.000Z' }), [agent('0123456789')])
    index.upsert(meta('new', { updatedAt: '2026-01-02T00:00:00.000Z' }), [agent('abcdefghij')])
    expect(index.coverage().indexedSessions).toBe(1)
    expect(index.search(query('abcdefghij')).total).toBe(1)
  })

  it('reports needsIndex for missing, failed and changed sessions', () => {
    const index = makeIndex()
    const m = meta('s1')
    expect(index.needsIndex(m)).toBe(true)
    index.upsert(m, [agent('x')])
    expect(index.needsIndex(m)).toBe(false)
    expect(index.needsIndex({ ...m, updatedAt: '2026-02-01T00:00:00.000Z' })).toBe(true)
    index.markFailed('s1', 'boom')
    expect(index.needsIndex(m)).toBe(true)
    expect(index.coverage()).toMatchObject({ failedSessions: 1, indexedSessions: 0 })
    index.remove('s1')
    expect(index.coverage().failedSessions).toBe(0)
  })
})

describe('SearchIndex persistence', () => {
  it('round-trips through flush and load with private file mode', async () => {
    const index = makeIndex()
    index.upsert(meta('s1', { title: 'Saved' }), [agent('Café persisted text')], { partial: true })
    index.markFailed('s2', 'read error')
    index.setKnownSessions(4)
    await index.flush()
    const file = join(temporary, 'index.json')
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600)

    const loaded = makeIndex()
    await loaded.load()
    expect(loaded.needsRebuild).toBe(false)
    const result = loaded.search(query('cafe'))
    expect(result.hits[0]).toMatchObject({ sessionId: 's1', title: 'Saved' })
    expect(highlighted(result.hits[0])).toEqual(['Café'])
    expect(result.coverage).toMatchObject({
      indexedSessions: 1,
      partialSessions: 1,
      failedSessions: 1,
      knownSessions: 4,
    })
  })

  it('starts empty and needs rebuild on malformed or unknown-version files', async () => {
    const file = join(temporary, 'index.json')
    await writeFile(file, '{not json')
    const index = makeIndex()
    await index.load()
    expect(index.needsRebuild).toBe(true)
    expect(index.coverage().indexedSessions).toBe(0)

    await writeFile(file, JSON.stringify({ schemaVersion: 2, sessions: {} }))
    const other = makeIndex()
    await other.load()
    expect(other.needsRebuild).toBe(true)
  })

  it('clear empties memory and deletes the file', async () => {
    const index = makeIndex()
    index.upsert(meta('s1'), [agent('gone soon')])
    await index.flush()
    const file = join(temporary, 'index.json')
    expect(JSON.parse(await readFile(file, 'utf8')).schemaVersion).toBe(1)
    await index.clear()
    await expect(stat(file)).rejects.toThrow()
    expect(index.search(query('gone')).total).toBe(0)
    expect(index.coverage().indexedSessions).toBe(0)
  })
})

function session(id: string, updatedAt = '2026-01-01T00:00:00.000Z'): MuseSession {
  return {
    sessionId: id,
    workspaceRoot: '/work/a',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
    status: 'idle',
    activeTurnId: null,
    modelId: null,
    title: `Session ${id}`,
    turnCount: 1,
  }
}

function fakeSource(pages: MuseSession[][], failing = new Set<string>()) {
  const reads: string[] = []
  let listCalls = 0
  const source: IndexSource & { reads: string[]; pages: MuseSession[][]; listFails: boolean } = {
    reads,
    pages,
    listFails: false,
    async listPage(cursor) {
      listCalls++
      const page = cursor ? Number(cursor) : 0
      if (source.listFails && page === 1) throw new Error('list broke')
      return {
        sessions: source.pages[page],
        nextCursor: page + 1 < source.pages.length ? String(page + 1) : null,
      }
    },
    async readSession(id) {
      reads.push(id)
      if (failing.has(id)) throw new Error('cannot read')
      return { items: [agent(`content of ${id} needle`)], partial: false }
    },
  }
  return { source, listCalls: () => listCalls }
}

describe('IndexBuilder', () => {
  it('pages through all sessions and only reindexes changed ones', async () => {
    const index = makeIndex()
    const { source, listCalls } = fakeSource([
      [session('a'), session('b')],
      [session('c')],
      [session('d')],
    ])
    const progress: number[] = []
    const builder = new IndexBuilder(index, source, {
      yieldMs: 0,
      onProgress: (coverage) => progress.push(coverage.indexedSessions),
    })
    const first = builder.start()
    expect(builder.start()).toBe(first)
    expect(builder.running).toBe(true)
    await first
    expect(builder.running).toBe(false)
    expect(listCalls()).toBe(3)
    expect(source.reads.sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(index.coverage()).toMatchObject({
      indexedSessions: 4,
      knownSessions: 4,
      building: false,
    })
    expect(index.coverage().lastBuiltAt).not.toBeNull()
    expect(progress.at(-1)).toBe(4)
    expect(index.search(query('needle')).total).toBe(4)

    source.reads.length = 0
    source.pages[1] = [session('c', '2026-02-01T00:00:00.000Z')]
    await builder.start()
    expect(source.reads).toEqual(['c'])

    const reloaded = makeIndex()
    await reloaded.load()
    expect(reloaded.coverage().indexedSessions).toBe(4)
  })

  it('records per-session failures and continues', async () => {
    const index = makeIndex()
    const { source } = fakeSource([[session('a'), session('b'), session('c')]], new Set(['b']))
    await new IndexBuilder(index, source, { yieldMs: 0 }).start()
    expect(index.coverage()).toMatchObject({
      indexedSessions: 2,
      failedSessions: 1,
      knownSessions: 3,
    })
  })

  it('cancel stops after the current session', async () => {
    const index = makeIndex()
    const { source } = fakeSource([['a', 'b', 'c', 'd', 'e'].map((id) => session(id))])
    const builder = new IndexBuilder(index, source, {
      yieldMs: 0,
      onProgress: (coverage) => {
        if (coverage.indexedSessions === 2) builder.cancel()
      },
    })
    await builder.start()
    expect(source.reads).toHaveLength(2)
    expect(index.coverage()).toMatchObject({ indexedSessions: 2, building: false })
  })

  it('retains only known sessions, and only after a complete listing', async () => {
    const index = makeIndex()
    const { source } = fakeSource([[session('a'), session('b')], [session('c')]])
    const builder = new IndexBuilder(index, source, { yieldMs: 0 })
    await builder.start()
    expect(index.coverage().indexedSessions).toBe(3)

    source.pages[0] = [session('a')]
    source.listFails = true
    await builder.start()
    expect(builder.lastError).toMatch(/list broke/)
    expect(index.coverage().indexedSessions).toBe(3)

    source.listFails = false
    await builder.start()
    expect(index.coverage().indexedSessions).toBe(2)
    expect(
      index
        .search(query('needle'))
        .hits.map((hit) => hit.sessionId)
        .sort(),
    ).toEqual(['a', 'c'])
  })
})

describe('SearchIndex scale', () => {
  it('indexes a 10,000-item session and searches it quickly', () => {
    const index = makeIndex()
    const items = Array.from({ length: 10_000 }, (_, i) =>
      i % 2 === 0
        ? user(`question ${i} about the résumé parser and widget ${i % 97}`)
        : agent(`answer ${i}: refactor module ${i % 13} and rerun tests ${'filler '.repeat(20)}`),
    )
    const indexStart = performance.now()
    index.upsert(meta('big'), items)
    const indexMs = performance.now() - indexStart
    const searchStart = performance.now()
    const result = index.search(query('resume widget', { limit: 100 }))
    const miss = index.search(query('"module 7" nonexistentterm'))
    const searchMs = performance.now() - searchStart
    console.info(
      `[search-index] 10k-item session: upsert ${indexMs.toFixed(1)}ms, two searches ${searchMs.toFixed(1)}ms`,
    )
    expect(result.total).toBe(5000)
    expect(result.hits).toHaveLength(100)
    expect(result.nextOffset).toBe(100)
    expect(miss.total).toBe(0)
    expect(index.coverage().indexedItems).toBe(10_000)
    expect(searchMs).toBeLessThan(2000)
  })
})
