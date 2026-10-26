import type { TranscriptItem } from '../../shared/protocol'
import { isInternalActivity } from './activity'
import { userMessageText } from './message-text'

export type FindMatch = { itemId: string; occurrence: number }

export const MAX_FIND_MATCHES = 5000

/** Text that a find bar searches for an item: exactly what the transcript displays as message text. */
export function searchableText(item: TranscriptItem) {
  if (item.retracted || isInternalActivity(item)) return ''
  if (item.kind === 'userMessage') return userMessageText(item)
  if (item.kind === 'agentMessage') return item.text || ''
  return ''
}

/**
 * Case-insensitive matches over the data model (not the DOM), so counts stay correct when
 * parts of a long transcript are not rendered. Overlapping occurrences are not double-counted.
 */
export function findMatches(items: TranscriptItem[], query: string, max = MAX_FIND_MATCHES) {
  const needle = query.toLocaleLowerCase()
  const matches: FindMatch[] = []
  if (!needle.trim()) return { matches, capped: false }
  for (const item of items) {
    const text = searchableText(item).toLocaleLowerCase()
    if (!text) continue
    let occurrence = 0
    for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
      if (matches.length >= max) return { matches, capped: true }
      matches.push({ itemId: item.itemId, occurrence: occurrence++ })
    }
  }
  return { matches, capped: false }
}

type HighlightRegistry = {
  set(name: string, value: unknown): void
  delete(name: string): void
}
declare const Highlight: { new (...ranges: Range[]): unknown } | undefined

function registry(): HighlightRegistry | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS
  return css?.highlights && typeof Highlight !== 'undefined' ? css.highlights : null
}

/** DOM ranges of `query` inside message bodies (headings, buttons and timestamps are skipped). */
export function textRanges(root: Element, query: string): Range[] {
  const needle = query.toLocaleLowerCase()
  if (!needle.trim()) return []
  const ranges: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest('.message-heading, button, .sr-only')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  })
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent || '').toLocaleLowerCase()
    for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + needle.length)
      ranges.push(range)
    }
  }
  return ranges
}

/**
 * Paints every rendered match and the current one. Rendered Markdown can differ from source text
 * (e.g. a match spanning `**bold**` markers), so when the current occurrence has no exact DOM
 * range the whole message is marked as current instead. Returns the element to reveal.
 */
export function paintFind(
  root: Element | null,
  query: string,
  current: FindMatch | undefined,
): HTMLElement | null {
  clearFind(root)
  if (!root || !query.trim()) return null
  const highlights = registry()
  const all: Range[] = []
  let currentRange: Range | undefined
  let currentElement: HTMLElement | null = null
  for (const element of root.querySelectorAll<HTMLElement>('[data-item-id]')) {
    const ranges = textRanges(element, query)
    all.push(...ranges)
    if (current && element.dataset.itemId === current.itemId) {
      currentElement = element
      currentRange = ranges[current.occurrence]
    }
  }
  if (highlights) {
    highlights.set('find-match', new Highlight!(...all))
    if (currentRange) highlights.set('find-current', new Highlight!(currentRange))
  }
  if (currentElement && (!currentRange || !highlights))
    currentElement.classList.add('find-current-item')
  return currentElement
}

export function clearFind(root: Element | null) {
  const highlights = registry()
  highlights?.delete('find-match')
  highlights?.delete('find-current')
  root
    ?.querySelectorAll('.find-current-item')
    .forEach((element) => element.classList.remove('find-current-item'))
}
