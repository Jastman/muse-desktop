import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { draftKeySchema, storedDraftSchema, type StoredDraft } from '../shared/protocol'

export const DRAFTS_SCHEMA_VERSION = 1
const fileSchema = z.object({
  schemaVersion: z.literal(DRAFTS_SCHEMA_VERSION),
  drafts: z.record(z.string(), z.unknown()),
})

export type DraftStoreOptions = {
  path: string
  maxEntries?: number
  maxAgeMs?: number
  persistDelayMs?: number
  now?: () => number
}

/**
 * Durable composer drafts. Stores text plus attachment *metadata* only: staged attachment bytes
 * and IDs live in memory and expire on restart, so restored drafts ask the user to reattach.
 */
export class DraftStore {
  private drafts = new Map<string, StoredDraft>()
  private timer?: ReturnType<typeof setTimeout>
  private writing: Promise<void> = Promise.resolve()
  private dirty = false
  private readonly maxEntries: number
  private readonly maxAgeMs: number
  private readonly persistDelayMs: number
  private readonly now: () => number
  notice?: string

  constructor(private options: DraftStoreOptions) {
    this.maxEntries = options.maxEntries ?? 200
    this.maxAgeMs = options.maxAgeMs ?? 30 * 24 * 60 * 60 * 1000
    this.persistDelayMs = options.persistDelayMs ?? 400
    this.now = options.now ?? Date.now
  }

  async load() {
    let raw: unknown
    try {
      raw = JSON.parse(await readFile(this.options.path, 'utf8'))
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
      // Drafts are a convenience cache: keep the unreadable file for inspection and start empty.
      await rename(this.options.path, `${this.options.path}.unreadable-${this.now()}`).catch(
        () => {},
      )
      this.notice = 'Saved drafts could not be read, so they were set aside.'
      return
    }
    const parsed = fileSchema.safeParse(raw)
    if (!parsed.success) {
      await rename(this.options.path, `${this.options.path}.unsupported-${this.now()}`).catch(
        () => {},
      )
      this.notice = 'Saved drafts used an unsupported format, so they were set aside.'
      return
    }
    for (const [key, value] of Object.entries(parsed.data.drafts)) {
      const draft = storedDraftSchema.safeParse(value)
      if (draft.success && draftKeySchema.safeParse(key).success && draft.data.key === key)
        this.drafts.set(key, draft.data)
    }
    if (this.prune()) this.schedule()
  }

  list(): StoredDraft[] {
    this.prune()
    return [...this.drafts.values()]
  }

  get(key: string) {
    return this.drafts.get(key)
  }

  set(key: string, draft: Omit<StoredDraft, 'key' | 'updatedAt'> | null, immediate = false) {
    draftKeySchema.parse(key)
    if (!draft || (!draft.text.trim() && !draft.attachments.length && !draft.sendState))
      this.drafts.delete(key)
    else
      this.drafts.set(
        key,
        storedDraftSchema.parse({ ...draft, key, updatedAt: new Date(this.now()).toISOString() }),
      )
    this.prune()
    return immediate ? this.flushNow() : (this.schedule(), Promise.resolve())
  }

  async clear(keys?: string[]) {
    if (keys) for (const key of keys) this.drafts.delete(key)
    else this.drafts.clear()
    if (!this.drafts.size) {
      clearTimeout(this.timer)
      this.dirty = false
      await this.writing
      await rm(this.options.path, { force: true })
      return
    }
    await this.flushNow()
  }

  async flush() {
    if (this.dirty) await this.flushNow()
    else await this.writing
  }

  private prune() {
    let changed = false
    const cutoff = this.now() - this.maxAgeMs
    for (const [key, draft] of this.drafts)
      if (Date.parse(draft.updatedAt) < cutoff) {
        this.drafts.delete(key)
        changed = true
      }
    if (this.drafts.size > this.maxEntries) {
      const oldest = [...this.drafts.values()].sort((a, b) =>
        a.updatedAt.localeCompare(b.updatedAt),
      )
      for (const draft of oldest.slice(0, this.drafts.size - this.maxEntries))
        this.drafts.delete(draft.key)
      changed = true
    }
    return changed
  }

  private schedule() {
    this.dirty = true
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flushNow().catch(() => {}), this.persistDelayMs)
  }

  private flushNow() {
    clearTimeout(this.timer)
    this.dirty = false
    const snapshot = JSON.stringify({
      schemaVersion: DRAFTS_SCHEMA_VERSION,
      drafts: Object.fromEntries(this.drafts),
    })
    const write = this.writing.then(async () => {
      await mkdir(dirname(this.options.path), { recursive: true, mode: 0o700 })
      const temporary = `${this.options.path}.${process.pid}.tmp`
      await writeFile(temporary, snapshot, { mode: 0o600 })
      await rename(temporary, this.options.path)
    })
    this.writing = write.catch(() => {})
    return write
  }
}
