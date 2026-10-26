import { describe, expect, it } from 'vitest'
import type { SearchIndexStatus, TranscriptItem } from '../../src/shared/protocol'
import { findMatches, searchableText } from '../../src/renderer/src/find'
import {
  coverageText,
  dateRange,
  snippetParts,
} from '../../src/renderer/src/components/HistorySearch'

const item = (itemId: string, kind: string, text: string, extra: Partial<TranscriptItem> = {}) =>
  ({ itemId, kind, revision: 1, status: 'completed', text, ...extra }) as TranscriptItem

describe('in-conversation find', () => {
  const items = [
    item('u1', 'userMessage', 'Fix the <div> in Foo and foo.ts'),
    item('a1', 'agentMessage', 'Updated **foo** handling. FOO done.'),
    item('t1', 'toolCall', 'foo'),
    item('r1', 'reasoning', 'thinking about foo'),
    item('x1', 'agentMessage', 'foo', { retracted: true }),
  ]

  it('counts case-insensitive matches only in displayed message text', () => {
    const { matches } = findMatches(items, 'foo')
    expect(matches).toEqual([
      { itemId: 'u1', occurrence: 0 },
      { itemId: 'u1', occurrence: 1 },
      { itemId: 'a1', occurrence: 0 },
      { itemId: 'a1', occurrence: 1 },
    ])
  })

  it('matches user-authored markup literally', () => {
    expect(findMatches(items, '<div>').matches).toEqual([{ itemId: 'u1', occurrence: 0 }])
  })

  it('does not double count overlapping occurrences and treats blank queries as empty', () => {
    expect(findMatches([item('a', 'agentMessage', 'aaaa')], 'aa').matches).toHaveLength(2)
    expect(findMatches(items, '   ').matches).toEqual([])
  })

  it('caps very large result sets and reports it', () => {
    const big = [item('b', 'agentMessage', 'x'.repeat(100))]
    const result = findMatches(big, 'x', 10)
    expect(result.matches).toHaveLength(10)
    expect(result.capped).toBe(true)
  })

  it('searches user messages through the same cleaning as the display', () => {
    const user = item('u', 'userMessage', 'raw', { displayText: 'shown text' })
    expect(searchableText(user)).toBe('shown text')
    expect(searchableText(item('t', 'toolCall', 'x'))).toBe('')
  })
})

describe('history search helpers', () => {
  it('splits snippets into text and highlighted parts without HTML', () => {
    expect(
      snippetParts('a <b>foo</b> foo', [
        [3, 6],
        [13, 16],
      ]),
    ).toEqual([
      { text: 'a <', match: false },
      { text: 'b>f', match: true },
      { text: 'oo</b> ', match: false },
      { text: 'foo', match: true },
    ])
    expect(snippetParts('abc', [[1, 99]])).toEqual([
      { text: 'a', match: false },
      { text: 'bc', match: true },
    ])
  })

  it('builds inclusive local date ranges', () => {
    const now = new Date('2026-01-10T12:00:00Z')
    expect(dateRange('any', { from: '', to: '' }, now)).toEqual({})
    expect(dateRange('7', { from: '', to: '' }, now).from).toBe('2026-01-03T12:00:00.000Z')
    const custom = dateRange('custom', { from: '2026-01-01', to: '2026-01-02' }, now)
    expect(new Date(custom.from!).getTime()).toBe(new Date('2026-01-01T00:00:00').getTime())
    expect(new Date(custom.to!).getTime()).toBe(new Date('2026-01-02T23:59:59.999').getTime())
  })

  it('discloses partial coverage honestly', () => {
    const status: SearchIndexStatus = {
      enabled: true,
      listingComplete: false,
      lastError: null,
      coverage: {
        indexedSessions: 3,
        knownSessions: 5,
        partialSessions: 1,
        failedSessions: 1,
        indexedItems: 10,
        lastBuiltAt: null,
        building: false,
        limits: { maxSessions: 1, maxItemsPerSession: 1, maxCharsPerItem: 1, maxTotalChars: 1 },
      },
    }
    expect(coverageText(status)).toBe(
      '3 of 5+ conversations indexed · 1 only partly indexed (size limits) · 1 could not be read · some older conversations were not listed',
    )
    expect(coverageText({ ...status, enabled: false })).toMatch(/turned off/)
  })
})
