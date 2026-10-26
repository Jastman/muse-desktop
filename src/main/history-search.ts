import type { HistorySearch, SearchIndexStatus } from '../shared/protocol'
import { IndexBuilder, SearchIndex, type IndexSource, type SearchResult } from './search-index'

/**
 * Owns the derived history index: when it is (re)built, whether it is enabled, and what is
 * reported to the renderer. Indexing reads durable CLI history only (never claims or subscribes
 * to a conversation) and never makes model or network calls.
 */
export class HistorySearchService {
  readonly index: SearchIndex
  private builder: IndexBuilder
  private timer: NodeJS.Timeout | null = null
  private rerun = false
  private lastEmit = 0
  private emitTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly options: {
      path: string
      source: IndexSource
      enabled: () => boolean
      connected: () => boolean
      onStatus: (status: SearchIndexStatus) => void
      yieldMs?: number
    },
  ) {
    this.index = new SearchIndex({ path: options.path })
    this.builder = this.createBuilder()
  }

  private createBuilder() {
    return new IndexBuilder(this.index, this.options.source, {
      yieldMs: this.options.yieldMs ?? 15,
      onProgress: () => this.notify(),
    })
  }

  async load() {
    await this.index.load()
  }

  status(): SearchIndexStatus {
    return {
      enabled: this.options.enabled(),
      coverage: this.index.coverage(),
      lastError: this.builder.lastError,
      listingComplete: this.builder.listingComplete,
    }
  }

  private notify(force = false) {
    const send = () => {
      this.lastEmit = Date.now()
      this.emitTimer = null
      this.options.onStatus(this.status())
    }
    if (force || Date.now() - this.lastEmit > 500) {
      if (this.emitTimer) clearTimeout(this.emitTimer)
      send()
    } else if (!this.emitTimer) {
      this.emitTimer = setTimeout(send, 500)
      this.emitTimer.unref?.()
    }
  }

  /** Debounced incremental update; only sessions whose `updatedAt` changed are re-read. */
  schedule(delayMs = 4000) {
    if (!this.options.enabled() || !this.options.connected()) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.run()
    }, delayMs)
    this.timer.unref?.()
  }

  private async run() {
    if (!this.options.enabled() || !this.options.connected()) return
    if (this.builder.running) {
      this.rerun = true
      return
    }
    await this.builder.start()
    this.notify(true)
    if (this.rerun) {
      this.rerun = false
      this.schedule(1000)
    }
  }

  async rebuild() {
    if (!this.options.enabled()) throw new Error('History search is turned off in Settings.')
    if (!this.options.connected()) throw new Error('Connect Muse Code to rebuild the index.')
    await this.stop()
    await this.index.clear()
    this.builder = this.createBuilder()
    void this.run()
    this.notify(true)
    return this.status()
  }

  async clear() {
    await this.stop()
    await this.index.clear()
    this.builder = this.createBuilder()
    this.notify(true)
    return this.status()
  }

  /** Turning history search off deletes the derived index; turning it on rebuilds it. */
  async setEnabled(enabled: boolean) {
    if (!enabled) await this.clear()
    else this.schedule(500)
  }

  search(query: HistorySearch, archivedIds: string[]): SearchResult {
    if (!this.options.enabled()) throw new Error('History search is turned off in Settings.')
    return this.index.search({ ...query, archivedIds })
  }

  private async stop() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.rerun = false
    this.builder.cancel()
    // Wait for the in-flight session read to settle so it cannot write into a cleared index.
    while (this.builder.running) await new Promise((resolve) => setTimeout(resolve, 10))
  }

  async close() {
    await this.stop()
    if (this.emitTimer) clearTimeout(this.emitTimer)
    await this.index.flush().catch(() => undefined)
  }
}
