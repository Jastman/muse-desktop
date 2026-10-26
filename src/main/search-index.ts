/**
 * Local, derived, rebuildable full-text index of Muse conversation history.
 *
 * The Muse CLI remains the source of truth. This index is only a cache: it can be deleted
 * (`clear()`) and rebuilt from the CLI at any time, and it never makes network or model calls.
 * Coverage (indexed / partial / failed / known sessions) is always reported with results so the
 * UI can disclose honestly what was searched.
 *
 * Semantics:
 * - Text and queries are normalized per code point with NFKD, combining marks stripped and
 *   lowercased, so `cafe` matches `café`. Stored text has whitespace collapsed.
 * - Queries split on whitespace; `"quoted phrases"` match contiguously. All terms/phrases must
 *   occur in the same item (AND).
 * - Date filters use the item's `recordedAt`, falling back to the session `updatedAt`.
 * - Hits are ordered by session `updatedAt` descending, then by transcript order (ascending)
 *   within a session. `total` is exact; at most `limit` (<= 100) hits are returned.
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { MuseSession, TranscriptItem } from '../shared/protocol'

export type IndexedSessionMeta = {
  sessionId: string
  title: string
  workspaceRoot: string | null
  updatedAt: string
  createdAt: string
}
export type SearchQuery = {
  text: string
  project?: string | null
  from?: string
  to?: string
  includeArchived: boolean
  archivedIds: string[]
  offset: number
  limit: number
}
export type SearchHit = {
  sessionId: string
  itemId: string
  title: string
  workspaceRoot: string | null
  updatedAt: string
  recordedAt?: string
  role: 'user' | 'assistant' | 'tool'
  snippet: string
  highlights: [number, number][]
  archived: boolean
}
export type IndexCoverage = {
  indexedSessions: number
  knownSessions: number
  partialSessions: number
  failedSessions: number
  indexedItems: number
  lastBuiltAt: string | null
  building: boolean
  limits: {
    maxSessions: number
    maxItemsPerSession: number
    maxCharsPerItem: number
    maxTotalChars: number
  }
}
export type SearchResult = {
  hits: SearchHit[]
  total: number
  nextOffset: number | null
  coverage: IndexCoverage
}
export type SearchIndexOptions = {
  path: string
  maxSessions?: number
  maxItemsPerSession?: number
  maxCharsPerItem?: number
  maxTotalChars?: number
  persistDelayMs?: number
  now?: () => Date
}

type Role = SearchHit['role']
type Doc = { itemId: string; role: Role; text: string; norm: string; recordedAt?: string }
type IndexedEntry = {
  state: 'indexed'
  meta: IndexedSessionMeta
  docs: Doc[]
  partial: boolean
  chars: number
}
type FailedEntry = { state: 'failed'; sessionId: string; reason: string; updatedAt?: string }
type Entry = IndexedEntry | FailedEntry

const SNIPPET_CHARS = 160
const SNIPPET_LEAD = 60
const MAX_LIMIT = 100

const metaSchema = z.object({
  sessionId: z.string(),
  title: z.string(),
  workspaceRoot: z.string().nullable(),
  updatedAt: z.string(),
  createdAt: z.string(),
})
const fileSchema = z.object({
  schemaVersion: z.literal(1),
  lastBuiltAt: z.string().nullable().optional(),
  knownSessions: z.number().int().nonnegative().optional(),
  evicted: z.record(z.string(), z.string()).optional(),
  sessions: z.record(
    z.string(),
    z.discriminatedUnion('state', [
      z.object({
        state: z.literal('indexed'),
        meta: metaSchema,
        partial: z.boolean(),
        docs: z.array(
          z.object({
            itemId: z.string(),
            role: z.enum(['user', 'assistant', 'tool']),
            text: z.string(),
            recordedAt: z.string().optional(),
          }),
        ),
      }),
      z.object({
        state: z.literal('failed'),
        reason: z.string(),
        updatedAt: z.string().optional(),
      }),
    ]),
  ),
})

const ASCII = /^[\x00-\x7f]*$/
const MARKS = /\p{M}/gu

function normalizeCodePoint(cp: string): string {
  return cp.normalize('NFKD').replace(MARKS, '').toLowerCase()
}

/** Normalizes text for matching. Per code point so positions can be mapped back to the original. */
export function normalizeForSearch(text: string): string {
  if (ASCII.test(text)) return text.toLowerCase()
  let out = ''
  for (const cp of text) out += normalizeCodePoint(cp)
  return out
}

/** For each normalized UTF-16 unit, the original [start, end) range it came from. */
function normalizedMap(text: string): { starts: number[]; ends: number[] } | null {
  if (ASCII.test(text)) return null
  const starts: number[] = []
  const ends: number[] = []
  let i = 0
  for (const cp of text) {
    const n = normalizeCodePoint(cp)
    for (let k = 0; k < n.length; k++) {
      starts.push(i)
      ends.push(i + cp.length)
    }
    i += cp.length
  }
  return { starts, ends }
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  let end = max
  const code = text.charCodeAt(end - 1)
  if (code >= 0xd800 && code <= 0xdbff) end -= 1
  return text.slice(0, end)
}

function itemDoc(item: TranscriptItem): { role: Role; text: string } | null {
  switch (item.kind) {
    case 'userMessage':
      return { role: 'user', text: item.displayText ?? item.text ?? '' }
    case 'agentMessage':
      return { role: 'assistant', text: item.text ?? '' }
    case 'toolCall':
    case 'userShell':
      return {
        role: 'tool',
        text: [item.tool, item.commandText, item.statusLine, item.failureReason]
          .filter((part): part is string => !!part && part.trim().length > 0)
          .join(' · '),
      }
    default:
      return null
  }
}

function parseQuery(text: string): string[] {
  const terms: string[] = []
  for (const match of text.matchAll(/"([^"]*)"|(\S+)/g)) {
    const raw = match[1] ?? match[2].replace(/"/g, '')
    const term = normalizeForSearch(collapse(raw))
    if (term) terms.push(term)
  }
  return terms
}

function time(value: string | undefined): number {
  if (!value) return Number.NaN
  return Date.parse(value)
}

export class SearchIndex {
  needsRebuild = false
  private readonly path: string
  private readonly limits: IndexCoverage['limits']
  private readonly persistDelayMs: number
  private readonly now: () => Date
  private sessions = new Map<string, Entry>()
  private evicted = new Map<string, string>()
  private knownSessions = 0
  private building = false
  private lastBuiltAt: string | null = null
  private totalChars = 0
  private timer: NodeJS.Timeout | null = null
  private writing: Promise<void> = Promise.resolve()

  constructor(options: SearchIndexOptions) {
    this.path = options.path
    this.limits = {
      maxSessions: options.maxSessions ?? 2000,
      maxItemsPerSession: options.maxItemsPerSession ?? 20000,
      maxCharsPerItem: options.maxCharsPerItem ?? 4000,
      maxTotalChars: options.maxTotalChars ?? 60_000_000,
    }
    this.persistDelayMs = options.persistDelayMs ?? 2000
    this.now = options.now ?? (() => new Date())
  }

  async load(): Promise<void> {
    this.reset()
    let raw: string
    try {
      raw = await readFile(this.path, 'utf8')
    } catch {
      this.needsRebuild = true
      return
    }
    let parsed: z.infer<typeof fileSchema>
    try {
      const result = fileSchema.safeParse(JSON.parse(raw))
      if (!result.success) throw result.error
      parsed = result.data
    } catch {
      this.needsRebuild = true
      return
    }
    this.needsRebuild = false
    this.lastBuiltAt = parsed.lastBuiltAt ?? null
    this.knownSessions = parsed.knownSessions ?? 0
    for (const [id, updatedAt] of Object.entries(parsed.evicted ?? {}))
      this.evicted.set(id, updatedAt)
    for (const [sessionId, stored] of Object.entries(parsed.sessions)) {
      if (stored.state === 'failed') {
        this.sessions.set(sessionId, {
          state: 'failed',
          sessionId,
          reason: stored.reason,
          updatedAt: stored.updatedAt,
        })
        continue
      }
      const docs: Doc[] = stored.docs.map((doc) => ({ ...doc, norm: normalizeForSearch(doc.text) }))
      const chars = docs.reduce((sum, doc) => sum + doc.text.length, 0)
      this.sessions.set(sessionId, {
        state: 'indexed',
        meta: { ...stored.meta, sessionId },
        docs,
        partial: stored.partial,
        chars,
      })
      this.totalChars += chars
    }
    this.enforceLimits()
  }

  needsIndex(meta: { sessionId: string; updatedAt: string }): boolean {
    const entry = this.sessions.get(meta.sessionId)
    if (!entry) return this.evicted.get(meta.sessionId) !== meta.updatedAt
    if (entry.state === 'failed') return true
    return entry.meta.updatedAt !== meta.updatedAt
  }

  upsert(meta: IndexedSessionMeta, items: TranscriptItem[], options?: { partial?: boolean }): void {
    let partial = options?.partial ?? false
    let docs: Doc[] = []
    for (const item of items) {
      const candidate = itemDoc(item)
      if (!candidate) continue
      let text = collapse(candidate.text)
      if (!text) continue
      if (text.length > this.limits.maxCharsPerItem) {
        text = truncate(text, this.limits.maxCharsPerItem)
        partial = true
      }
      docs.push({
        itemId: item.itemId,
        role: candidate.role,
        text,
        norm: normalizeForSearch(text),
        ...(item.recordedAt ? { recordedAt: item.recordedAt } : {}),
      })
    }
    if (docs.length > this.limits.maxItemsPerSession) {
      docs = docs.slice(docs.length - this.limits.maxItemsPerSession)
      partial = true
    }
    this.dropEntry(meta.sessionId)
    this.evicted.delete(meta.sessionId)
    const chars = docs.reduce((sum, doc) => sum + doc.text.length, 0)
    this.sessions.set(meta.sessionId, { state: 'indexed', meta: { ...meta }, docs, partial, chars })
    this.totalChars += chars
    this.enforceLimits()
    this.schedulePersist()
  }

  markFailed(sessionId: string, reason: string, updatedAt?: string): void {
    this.dropEntry(sessionId)
    this.evicted.delete(sessionId)
    this.sessions.set(sessionId, { state: 'failed', sessionId, reason, updatedAt })
    this.schedulePersist()
  }

  remove(sessionId: string): void {
    const existed = this.sessions.has(sessionId) || this.evicted.has(sessionId)
    this.dropEntry(sessionId)
    this.evicted.delete(sessionId)
    if (existed) this.schedulePersist()
  }

  retain(sessionIds: Set<string>): void {
    let changed = false
    for (const id of [...this.sessions.keys()]) {
      if (sessionIds.has(id)) continue
      this.dropEntry(id)
      changed = true
    }
    for (const id of [...this.evicted.keys()]) {
      if (sessionIds.has(id)) continue
      this.evicted.delete(id)
      changed = true
    }
    if (changed) this.schedulePersist()
  }

  setKnownSessions(count: number): void {
    this.knownSessions = Math.max(0, Math.floor(count))
  }

  setBuilding(building: boolean): void {
    if (this.building && !building) {
      this.lastBuiltAt = this.now().toISOString()
      this.schedulePersist()
    }
    this.building = building
  }

  async clear(): Promise<void> {
    this.cancelTimer()
    await this.writing
    this.reset()
    this.lastBuiltAt = null
    this.needsRebuild = true
    await rm(this.path, { force: true })
  }

  async flush(): Promise<void> {
    this.cancelTimer()
    await this.persist()
  }

  coverage(): IndexCoverage {
    let indexedSessions = 0
    let partialSessions = 0
    let failedSessions = 0
    let indexedItems = 0
    for (const entry of this.sessions.values()) {
      if (entry.state === 'failed') {
        failedSessions++
        continue
      }
      indexedSessions++
      if (entry.partial) partialSessions++
      indexedItems += entry.docs.length
    }
    return {
      indexedSessions,
      knownSessions: Math.max(this.knownSessions, indexedSessions + failedSessions),
      partialSessions,
      failedSessions,
      indexedItems,
      lastBuiltAt: this.lastBuiltAt,
      building: this.building,
      limits: { ...this.limits },
    }
  }

  search(query: SearchQuery): SearchResult {
    const offset = Math.max(0, Math.floor(query.offset) || 0)
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(query.limit) || 1))
    const terms = parseQuery(query.text)
    const coverage = this.coverage()
    if (terms.length === 0) return { hits: [], total: 0, nextOffset: null, coverage }
    const archived = new Set(query.archivedIds)
    const from = query.from ? time(query.from) : null
    const to = query.to ? time(query.to) : null
    const entries = [...this.sessions.values()]
      .filter((entry): entry is IndexedEntry => entry.state === 'indexed')
      .filter((entry) => query.includeArchived || !archived.has(entry.meta.sessionId))
      .filter((entry) => query.project == null || entry.meta.workspaceRoot === query.project)
      .sort((a, b) => {
        const diff = (time(b.meta.updatedAt) || 0) - (time(a.meta.updatedAt) || 0)
        if (diff !== 0) return diff
        return a.meta.sessionId < b.meta.sessionId
          ? -1
          : a.meta.sessionId > b.meta.sessionId
            ? 1
            : 0
      })
    const hits: SearchHit[] = []
    let total = 0
    for (const entry of entries) {
      const sessionTime = time(entry.meta.updatedAt)
      for (const doc of entry.docs) {
        if (from !== null || to !== null) {
          const at =
            doc.recordedAt && !Number.isNaN(time(doc.recordedAt))
              ? time(doc.recordedAt)
              : sessionTime
          if (Number.isNaN(at)) continue
          if (from !== null && !(at >= from)) continue
          if (to !== null && !(at <= to)) continue
        }
        if (!terms.every((term) => doc.norm.includes(term))) continue
        if (total >= offset && hits.length < limit) {
          hits.push(this.hit(entry, doc, terms, archived.has(entry.meta.sessionId)))
        }
        total++
      }
    }
    const nextOffset = offset + hits.length < total ? offset + hits.length : null
    return { hits, total, nextOffset, coverage }
  }

  private hit(entry: IndexedEntry, doc: Doc, terms: string[], archived: boolean): SearchHit {
    const { snippet, highlights } = buildSnippet(doc.text, doc.norm, terms)
    return {
      sessionId: entry.meta.sessionId,
      itemId: doc.itemId,
      title: entry.meta.title,
      workspaceRoot: entry.meta.workspaceRoot,
      updatedAt: entry.meta.updatedAt,
      ...(doc.recordedAt ? { recordedAt: doc.recordedAt } : {}),
      role: doc.role,
      snippet,
      highlights,
      archived,
    }
  }

  private dropEntry(sessionId: string): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    if (entry.state === 'indexed') this.totalChars -= entry.chars
    this.sessions.delete(sessionId)
  }

  /** Evicts least-recently-updated sessions until both session and character budgets fit. */
  private enforceLimits(): void {
    const indexed = () =>
      [...this.sessions.values()].filter(
        (entry): entry is IndexedEntry => entry.state === 'indexed',
      )
    let current = indexed()
    if (current.length <= this.limits.maxSessions && this.totalChars <= this.limits.maxTotalChars) {
      return
    }
    current = current.sort((a, b) => (time(a.meta.updatedAt) || 0) - (time(b.meta.updatedAt) || 0))
    let count = current.length
    for (const entry of current) {
      if (count <= this.limits.maxSessions && this.totalChars <= this.limits.maxTotalChars) break
      this.dropEntry(entry.meta.sessionId)
      this.evicted.set(entry.meta.sessionId, entry.meta.updatedAt)
      count--
    }
  }

  private reset(): void {
    this.cancelTimer()
    this.sessions = new Map()
    this.evicted = new Map()
    this.knownSessions = 0
    this.totalChars = 0
  }

  private cancelTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedulePersist(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.persist().catch(() => undefined)
    }, this.persistDelayMs)
    this.timer.unref?.()
  }

  private persist(): Promise<void> {
    const write = async () => {
      const sessions: Record<string, unknown> = {}
      for (const [id, entry] of this.sessions) {
        sessions[id] =
          entry.state === 'failed'
            ? { state: 'failed', reason: entry.reason, updatedAt: entry.updatedAt }
            : {
                state: 'indexed',
                meta: entry.meta,
                partial: entry.partial,
                docs: entry.docs.map(({ itemId, role, text, recordedAt }) => ({
                  itemId,
                  role,
                  text,
                  recordedAt,
                })),
              }
      }
      const body = JSON.stringify({
        schemaVersion: 1,
        lastBuiltAt: this.lastBuiltAt,
        knownSessions: this.knownSessions,
        evicted: Object.fromEntries(this.evicted),
        sessions,
      })
      await mkdir(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
      try {
        await writeFile(temporary, body, { mode: 0o600 })
        await rename(temporary, this.path)
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined)
        throw error
      }
    }
    const next = this.writing.catch(() => undefined).then(write)
    this.writing = next.catch(() => undefined)
    return next
  }
}

function buildSnippet(
  text: string,
  norm: string,
  terms: string[],
): { snippet: string; highlights: [number, number][] } {
  const map = normalizedMap(text)
  const toOriginal = (start: number, end: number): [number, number] =>
    map ? [map.starts[start], map.ends[end - 1]] : [start, end]
  const ranges: [number, number][] = []
  for (const term of terms) {
    let at = norm.indexOf(term)
    while (at !== -1) {
      ranges.push(toOriginal(at, at + term.length))
      at = norm.indexOf(term, at + term.length)
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const first = ranges[0]?.[0] ?? 0
  let start = Math.max(0, first - SNIPPET_LEAD)
  let end = Math.min(text.length, start + SNIPPET_CHARS)
  start = Math.max(0, end - SNIPPET_CHARS)
  if (start > 0 && isLowSurrogate(text.charCodeAt(start))) start++
  if (end < text.length && isLowSurrogate(text.charCodeAt(end))) end++
  while (start < end && text[start] === ' ') start++
  while (end > start && text[end - 1] === ' ') end--
  const prefix = start > 0 ? '…' : ''
  const snippet = prefix + text.slice(start, end) + (end < text.length ? '…' : '')
  const highlights: [number, number][] = []
  for (const [a, b] of ranges) {
    const s = Math.max(a, start)
    const e = Math.min(b, end)
    if (e <= s) continue
    const range: [number, number] = [s - start + prefix.length, e - start + prefix.length]
    const last = highlights[highlights.length - 1]
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else highlights.push(range)
  }
  return { snippet, highlights }
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

export type IndexSource = {
  listPage(cursor?: string): Promise<{ sessions: MuseSession[]; nextCursor: string | null }>
  readSession(sessionId: string): Promise<{ items: TranscriptItem[]; partial: boolean }>
}

export function sessionMeta(session: MuseSession): IndexedSessionMeta {
  return {
    sessionId: session.sessionId,
    title: session.title || session.name || session.firstUserPrompt || 'Untitled session',
    workspaceRoot: session.workspaceRoot,
    updatedAt: session.updatedAt,
    createdAt: session.createdAt,
  }
}

/**
 * Background, bounded builder: lists every CLI session page, then reads and indexes stale
 * sessions one at a time, yielding between sessions. Listing errors stop listing (recorded in
 * `lastError`); sessions already listed are still indexed but nothing is pruned.
 */
export class IndexBuilder {
  lastError: string | null = null
  listingComplete = false
  private promise: Promise<void> | null = null
  private cancelled = false
  private readonly yieldMs: number
  private readonly maxPages: number
  private readonly onProgress?: (coverage: IndexCoverage) => void

  constructor(
    private readonly index: SearchIndex,
    private readonly source: IndexSource,
    options?: {
      yieldMs?: number
      onProgress?: (coverage: IndexCoverage) => void
      maxPages?: number
    },
  ) {
    this.yieldMs = options?.yieldMs ?? 10
    this.maxPages = options?.maxPages ?? 50
    this.onProgress = options?.onProgress
  }

  get running(): boolean {
    return this.promise !== null
  }

  start(): Promise<void> {
    if (this.promise) return this.promise
    this.cancelled = false
    this.promise = this.run().finally(() => {
      this.promise = null
    })
    return this.promise
  }

  cancel(): void {
    if (this.promise) this.cancelled = true
  }

  private progress(): void {
    try {
      this.onProgress?.(this.index.coverage())
    } catch {
      // Progress listeners must not break indexing.
    }
  }

  private async run(): Promise<void> {
    this.lastError = null
    this.listingComplete = false
    this.index.setBuilding(true)
    this.progress()
    try {
      const sessions: MuseSession[] = []
      const seen = new Set<string>()
      let cursor: string | undefined
      try {
        for (let page = 0; page < this.maxPages && !this.cancelled; page++) {
          const result = await this.source.listPage(cursor)
          for (const session of result.sessions) {
            if (seen.has(session.sessionId)) continue
            seen.add(session.sessionId)
            sessions.push(session)
          }
          if (!result.nextCursor) {
            this.listingComplete = true
            break
          }
          cursor = result.nextCursor
        }
        if (!this.listingComplete && !this.cancelled) {
          this.lastError = `Session listing stopped after ${this.maxPages} pages`
        }
      } catch (error) {
        this.lastError = `Session listing failed: ${error instanceof Error ? error.message : String(error)}`
      }
      this.index.setKnownSessions(sessions.length)
      if (this.listingComplete) this.index.retain(seen)
      this.progress()
      const sorted = [...sessions].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      for (const session of sorted) {
        if (this.cancelled) break
        if (!this.index.needsIndex(session)) continue
        try {
          const { items, partial } = await this.source.readSession(session.sessionId)
          this.index.upsert(sessionMeta(session), items, { partial })
        } catch (error) {
          this.index.markFailed(
            session.sessionId,
            error instanceof Error ? error.message : String(error),
            session.updatedAt,
          )
        }
        this.progress()
        await new Promise((resolve) => setTimeout(resolve, this.yieldMs))
      }
      if (this.listingComplete && !this.cancelled) this.index.needsRebuild = false
    } finally {
      this.index.setBuilding(false)
      await this.index.flush().catch((error: unknown) => {
        this.lastError ??= `Persisting index failed: ${error instanceof Error ? error.message : String(error)}`
      })
      this.progress()
    }
  }
}
