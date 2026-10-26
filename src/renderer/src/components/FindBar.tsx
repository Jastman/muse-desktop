import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import type { TranscriptItem } from '../../../shared/protocol'
import { clearFind, findMatches, paintFind } from '../find'
import { IconButton } from './Primitives'

export function FindBar({
  focusSignal,
  items,
  onReveal,
  onClose,
}: {
  focusSignal: number
  items: TranscriptItem[]
  onReveal: (itemId: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const { matches, capped } = useMemo(() => findMatches(items, query), [items, query])
  const current = matches.length ? matches[Math.min(index, matches.length - 1)] : undefined
  const root = () => document.querySelector('.transcript')

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => {
      clearFind(root())
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [focusSignal])

  useEffect(() => {
    if (current) onReveal(current.itemId)
    // Only re-reveal when the selected match changes, not on every streamed token.
  }, [current?.itemId, current?.occurrence, query])

  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => paintFind(root(), query, current))
    })
    return () => cancelAnimationFrame(frame)
  }, [items, query, current])

  const step = (delta: number) => {
    if (!matches.length) return
    setIndex(
      (value) => (Math.min(value, matches.length - 1) + delta + matches.length) % matches.length,
    )
  }
  const count = !query
    ? ''
    : matches.length
      ? `${Math.min(index, matches.length - 1) + 1} of ${matches.length}${capped ? '+' : ''}`
      : 'No results'

  return (
    <div className="find-bar" role="search" aria-label="Find in conversation">
      <Search size={15} aria-hidden />
      <input
        ref={input}
        value={query}
        aria-label="Find in conversation"
        aria-describedby="find-count"
        placeholder="Find in conversation"
        maxLength={500}
        onChange={(event) => {
          setQuery(event.target.value)
          setIndex(0)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            step(event.shiftKey ? -1 : 1)
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onClose()
          }
        }}
      />
      <span id="find-count" className="find-count" role="status" aria-live="polite">
        {count}
      </span>
      <IconButton label="Previous match" disabled={!matches.length} onClick={() => step(-1)}>
        <ChevronUp size={15} />
      </IconButton>
      <IconButton label="Next match" disabled={!matches.length} onClick={() => step(1)}>
        <ChevronDown size={15} />
      </IconButton>
      <IconButton label="Close find" onClick={onClose}>
        <X size={15} />
      </IconButton>
    </div>
  )
}
