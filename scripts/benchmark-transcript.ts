/**
 * Reproducible synthetic long-history benchmark: `npm run benchmark`.
 *
 * Measures the data path of a 10,000-item transcript on THIS machine (no network, no CLI, no
 * Electron renderer). It reports what a whole-transcript snapshot costs per streamed update versus
 * a single-item delta, plus find and search-normalization cost. It deliberately does NOT measure
 * DOM render time or frame rate: the transcript is not virtualized yet (see docs/performance.md).
 */
import { performance } from 'node:perf_hooks'
import { cpus, platform, arch, release, totalmem } from 'node:os'
import { serialize, deserialize } from 'node:v8'
import { findMatches } from '../src/renderer/src/find'
import { userMessageText } from '../src/renderer/src/message-text'
import { normalizeForSearch } from '../src/main/search-index'
import type { TranscriptItem } from '../src/shared/protocol'

const ITEMS = Number(process.env.BENCH_ITEMS || 10_000)
const RUNS = Number(process.env.BENCH_RUNS || 15)

function makeItems(count: number): TranscriptItem[] {
  const items: TranscriptItem[] = []
  for (let i = 0; i < count; i++) {
    const turn = `turn-${Math.floor(i / 4)}`
    const base = { itemId: `item-${i}`, revision: 1, status: 'completed', turnId: turn }
    const body = `Synthetic paragraph ${i}. `.repeat(12) + (i % 97 === 0 ? 'needle ' : '')
    if (i % 4 === 0) items.push({ ...base, kind: 'userMessage', text: body, displayText: body })
    else if (i % 4 === 1)
      items.push({ ...base, kind: 'agentMessage', text: `## Reply ${i}\n\n${body}` })
    else if (i % 4 === 2)
      items.push({
        ...base,
        kind: 'toolCall',
        tool: 'shell',
        commandText: `echo ${i}`,
        visibleOutput: body,
      })
    else items.push({ ...base, kind: 'agentMessage', text: body })
  }
  return items
}

function time<T>(fn: () => T): { ms: number; value: T } {
  const start = performance.now()
  const value = fn()
  return { ms: performance.now() - start, value }
}

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b)
  const pick = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
  return { median: pick(0.5), p95: pick(0.95), max: sorted[sorted.length - 1] }
}

function measure(label: string, fn: () => unknown) {
  fn()
  const s = stats(Array.from({ length: RUNS }, () => time(fn).ms))
  const round = (value: number) => +value.toFixed(3)
  return { label, median: round(s.median), p95: round(s.p95), max: round(s.max) }
}

const items = makeItems(ITEMS)
const heapBefore = process.memoryUsage().heapUsed
const snapshot = serialize({ items })
const delta = serialize({ itemId: items[1].itemId, revision: 2, item: items[1] })
const results = [
  measure('whole-transcript snapshot: structured clone (IPC proxy)', () =>
    deserialize(serialize({ items })),
  ),
  measure('single-item delta: structured clone (IPC proxy)', () =>
    deserialize(serialize({ itemId: items[1].itemId, revision: 2, item: items[1] })),
  ),
  measure('derive display text for every user message', () =>
    items.filter((item) => item.kind === 'userMessage').map(userMessageText),
  ),
  measure('find-in-conversation over all items', () => findMatches(items, 'needle')),
  measure('normalize every item for history indexing', () =>
    items.map((item) => normalizeForSearch(item.text ?? '')),
  ),
]
const heapMb = (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024
const report = {
  environment: {
    node: process.version,
    platform: `${platform()} ${release()} ${arch()}`,
    cpu: `${cpus()[0]?.model ?? 'unknown'} x${cpus().length}`,
    totalMemoryGb: +(totalmem() / 1024 ** 3).toFixed(1),
  },
  items: ITEMS,
  runs: RUNS,
  snapshotBytes: snapshot.byteLength,
  deltaBytes: delta.byteLength,
  heapGrowthMb: +heapMb.toFixed(1),
  timingsMs: results,
}
console.log(JSON.stringify(report, null, 2))

// Budgets (CI-safe, deliberately loose so shared runners do not flake; see docs/performance.md).
const budgets: Record<string, number> = {
  'single-item delta: structured clone (IPC proxy)': 5,
  'find-in-conversation over all items': 250,
  'derive display text for every user message': 250,
}
let failed = false
for (const result of results) {
  const budget = budgets[result.label]
  if (budget !== undefined && result.p95 > budget) {
    console.error(`BUDGET EXCEEDED: ${result.label} p95 ${result.p95}ms > ${budget}ms`)
    failed = true
  }
}
process.exit(failed ? 1 : 0)
