import { useEffect, useMemo, useRef, useState } from 'react'
import { Archive, Database, MessageSquare, RefreshCw, Search, Trash2 } from 'lucide-react'
import type { SearchHit, SearchIndexStatus, SearchResult } from '../../../shared/protocol'
import { Dialog, projectName } from './Primitives'

const PAGE = 25
type DatePreset = 'any' | '7' | '30' | '365' | 'custom'

export function snippetParts(snippet: string, highlights: [number, number][]) {
  const parts: { text: string; match: boolean }[] = []
  let cursor = 0
  for (const [start, end] of [...highlights].sort((a, b) => a[0] - b[0])) {
    const from = Math.max(cursor, Math.min(start, snippet.length))
    const to = Math.max(from, Math.min(end, snippet.length))
    if (from > cursor) parts.push({ text: snippet.slice(cursor, from), match: false })
    if (to > from) parts.push({ text: snippet.slice(from, to), match: true })
    cursor = to
  }
  if (cursor < snippet.length) parts.push({ text: snippet.slice(cursor), match: false })
  return parts
}

export function dateRange(
  preset: DatePreset,
  custom: { from: string; to: string },
  now = new Date(),
): { from?: string; to?: string } {
  if (preset === 'any') return {}
  if (preset === 'custom') {
    const range: { from?: string; to?: string } = {}
    if (custom.from) range.from = new Date(`${custom.from}T00:00:00`).toISOString()
    if (custom.to) range.to = new Date(`${custom.to}T23:59:59.999`).toISOString()
    return range
  }
  return { from: new Date(now.getTime() - Number(preset) * 86_400_000).toISOString() }
}

export function coverageText(status: SearchIndexStatus | null) {
  if (!status) return 'Checking the search index…'
  if (!status.enabled)
    return 'History search is turned off. Turn it on in Settings → Privacy & data.'
  const c = status.coverage
  const parts = [
    `${c.indexedSessions} of ${status.listingComplete ? c.knownSessions : `${c.knownSessions}+`} conversations indexed`,
  ]
  if (c.building) parts.push('indexing in progress')
  if (c.partialSessions) parts.push(`${c.partialSessions} only partly indexed (size limits)`)
  if (c.failedSessions) parts.push(`${c.failedSessions} could not be read`)
  if (!status.listingComplete && !c.building) parts.push('some older conversations were not listed')
  return parts.join(' · ')
}

export function HistorySearch({
  initialQuery = '',
  projects,
  onOpen,
  onClose,
}: {
  initialQuery?: string
  projects: string[]
  onOpen: (hit: SearchHit) => void
  onClose: () => void
}) {
  const [text, setText] = useState(initialQuery)
  const [project, setProject] = useState<string>('')
  const [preset, setPreset] = useState<DatePreset>('any')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [includeArchived, setIncludeArchived] = useState(false)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [hits, setHits] = useState<SearchHit[]>([])
  const [status, setStatus] = useState<SearchIndexStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState(0)
  const generation = useRef(0)

  useEffect(() => {
    void window.muse.searchIndexStatus().then(setStatus, () => undefined)
    return window.muse.onEvent((event) => {
      if (event.type === 'search-index') setStatus(event.status)
    })
  }, [])

  const query = useMemo(
    () => ({
      text: text.trim(),
      project: project || null,
      includeArchived,
      ...dateRange(preset, custom),
    }),
    [text, project, includeArchived, preset, custom],
  )
  const building = status?.coverage.building
  const indexedSessions = status?.coverage.indexedSessions

  useEffect(() => {
    const run = ++generation.current
    if (!query.text) {
      setResult(null)
      setHits([])
      setError('')
      return
    }
    const timer = setTimeout(() => {
      setBusy(true)
      window.muse
        .searchHistory({ ...query, offset: 0, limit: PAGE })
        .then((next) => {
          if (run !== generation.current) return
          setResult(next)
          setHits(next.hits)
          setSelected(0)
          setError('')
        })
        .catch((reason: unknown) => {
          if (run === generation.current) setError(errorText(reason))
        })
        .finally(() => run === generation.current && setBusy(false))
    }, 150)
    return () => clearTimeout(timer)
    // Re-run when indexing makes progress so results are not stale while the index fills in.
  }, [query, building, indexedSessions])

  const loadMore = () => {
    if (!result?.nextOffset) return
    const run = generation.current
    setBusy(true)
    window.muse
      .searchHistory({ ...query, offset: result.nextOffset, limit: PAGE })
      .then((next) => {
        if (run !== generation.current) return
        setResult(next)
        setHits((current) => [...current, ...next.hits])
      })
      .catch((reason: unknown) => setError(errorText(reason)))
      .finally(() => setBusy(false))
  }

  const act = (action: () => Promise<SearchIndexStatus>) =>
    action().then(setStatus, (reason: unknown) => setError(errorText(reason)))

  const open = (hit: SearchHit | undefined) => {
    if (!hit) return
    onClose()
    onOpen(hit)
  }

  return (
    <Dialog title="Search message history" onClose={onClose} className="history-dialog">
      <div className="command-search">
        <Search size={19} />
        <input
          autoFocus
          value={text}
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls="history-results"
          aria-autocomplete="list"
          aria-activedescendant={hits[selected] ? `history-hit-${selected}` : undefined}
          aria-label="Search message history"
          placeholder="Search messages in past conversations…"
          maxLength={500}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setSelected((value) => Math.min(value + 1, hits.length - 1))
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setSelected((value) => Math.max(0, value - 1))
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              open(hits[selected])
            }
          }}
        />
      </div>
      <div className="history-filters">
        <label>
          Project
          <select value={project} onChange={(event) => setProject(event.target.value)}>
            <option value="">All projects</option>
            {projects.map((path) => (
              <option key={path} value={path}>
                {projectName(path)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date
          <select value={preset} onChange={(event) => setPreset(event.target.value as DatePreset)}>
            <option value="any">Any time</option>
            <option value="7">Past 7 days</option>
            <option value="30">Past 30 days</option>
            <option value="365">Past year</option>
            <option value="custom">Custom range…</option>
          </select>
        </label>
        {preset === 'custom' && (
          <>
            <label>
              From
              <input
                type="date"
                value={custom.from}
                onChange={(event) => setCustom((value) => ({ ...value, from: event.target.value }))}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={custom.to}
                onChange={(event) => setCustom((value) => ({ ...value, to: event.target.value }))}
              />
            </label>
          </>
        )}
        <label className="history-archived">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
          />
          Include archived conversations
        </label>
      </div>
      <div className="history-coverage" role="status" aria-live="polite">
        <Database size={14} />
        <span>{coverageText(status)}</span>
        {status?.lastError && <span className="history-error">Last error: {status.lastError}</span>}
        {status?.enabled && (
          <span className="history-actions">
            <button type="button" onClick={() => act(() => window.muse.rebuildSearchIndex())}>
              <RefreshCw size={13} /> Rebuild
            </button>
            <button type="button" onClick={() => act(() => window.muse.clearSearchIndex())}>
              <Trash2 size={13} /> Clear index
            </button>
          </span>
        )}
      </div>
      <div
        className="command-results history-results"
        id="history-results"
        role="listbox"
        aria-label="Matching messages"
        aria-busy={busy}
      >
        {hits.map((hit, i) => (
          <button
            key={`${hit.sessionId}:${hit.itemId}`}
            id={`history-hit-${i}`}
            role="option"
            aria-selected={i === selected}
            tabIndex={-1}
            className={i === selected ? 'selected history-hit' : 'history-hit'}
            onClick={() => open(hit)}
            onMouseEnter={() => setSelected(i)}
          >
            <MessageSquare size={16} />
            <span>
              <strong>
                {hit.title}
                {hit.archived && (
                  <em className="history-badge">
                    <Archive size={11} /> Archived
                  </em>
                )}
              </strong>
              <small>
                {hit.workspaceRoot ? projectName(hit.workspaceRoot) : 'No project'} ·{' '}
                {hit.role === 'user' ? 'You' : hit.role === 'assistant' ? 'Muse' : 'Tool'} ·{' '}
                {new Date(hit.recordedAt ?? hit.updatedAt).toLocaleDateString()}
              </small>
              <span className="history-snippet">
                {snippetParts(hit.snippet, hit.highlights).map((part, index) =>
                  part.match ? <mark key={index}>{part.text}</mark> : part.text,
                )}
              </span>
            </span>
          </button>
        ))}
        {error && (
          <div className="command-empty" role="alert">
            {error}
          </div>
        )}
        {!error && query.text && result && !hits.length && (
          <div className="command-empty" role="status">
            No indexed messages match.{' '}
            {status?.coverage.building ? 'Indexing is still running.' : ''}
          </div>
        )}
        {!query.text && (
          <div className="command-empty">
            Search runs locally against a rebuildable index of your Muse Code history. No text is
            sent to a model or the network.
          </div>
        )}
      </div>
      <footer>
        <span role="status">
          {result ? `${hits.length} of ${result.total} matches` : busy ? 'Searching…' : ''}
        </span>
        {result?.nextOffset != null && (
          <button type="button" className="history-more" disabled={busy} onClick={loadMore}>
            Load more
          </button>
        )}
      </footer>
    </Dialog>
  )
}

function errorText(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
