import { useCallback, useEffect, useRef, useState } from 'react'
import type { Attachment, DraftInput, StoredDraft } from '../../../shared/protocol'

export type DraftAttachmentMeta = StoredDraft['attachments'][number]
type DraftState = {
  text: Record<string, string>
  attachments: Record<string, Attachment[]>
  /** Attachments restored from disk: bytes are gone, so they are shown but never sent. */
  stale: Record<string, DraftAttachmentMeta[]>
  /** A send started but its outcome is unknown (restart or lost connection). */
  uncertain: Record<string, boolean>
}

export const sessionDraftKey = (sessionId: string) => `session:${sessionId}`
export const newDraftKey = (project: string) => `new:${project}`

const empty: DraftState = { text: {}, attachments: {}, stale: {}, uncertain: {} }
const noAttachments: Attachment[] = []
const noStale: DraftAttachmentMeta[] = []

export function draftInput(state: DraftState, key: string): DraftInput | null {
  const text = state.text[key] || ''
  const attachments = [
    ...(state.attachments[key] || []).map(({ name, kind, size }) => ({ name, kind, size })),
    ...(state.stale[key] || []),
  ].slice(0, 5)
  if (!text.trim() && !attachments.length && !state.uncertain[key]) return null
  return { text, attachments, ...(state.uncertain[key] ? { sendState: 'sending' as const } : {}) }
}

/** Composer drafts per conversation/new-project scope, persisted through the narrow bridge. */
export function useDrafts(onError: (message: string) => void, delayMs = 400) {
  const [state, setState] = useState<DraftState>(empty)
  const [notice, setNotice] = useState<string>()
  const latest = useRef(state)
  latest.current = state
  const saved = useRef(new Map<string, string>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const loaded = useRef(false)
  const errorRef = useRef(onError)
  errorRef.current = onError

  const commit = useCallback((next: DraftState) => {
    latest.current = next
    setState(next)
  }, [])

  const persist = useCallback((key: string, immediate = false) => {
    clearTimeout(timers.current.get(key))
    timers.current.delete(key)
    const input = draftInput(latest.current, key)
    const serialized = JSON.stringify(input)
    if (saved.current.get(key) === serialized) return Promise.resolve()
    saved.current.set(key, serialized)
    return window.muse.saveDraft(key, input, immediate).catch((error: Error) => {
      saved.current.delete(key)
      // Unknown project scopes (for example a removed recent project) are kept in memory only.
      if (!/projects opened/.test(error.message)) errorRef.current(error.message)
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.muse
      .listDrafts()
      .then(({ drafts, notice }) => {
        if (cancelled) return
        loaded.current = true
        setNotice(notice)
        {
          const current = latest.current
          const next: DraftState = {
            text: { ...current.text },
            attachments: current.attachments,
            stale: { ...current.stale },
            uncertain: { ...current.uncertain },
          }
          for (const draft of drafts) {
            // Never replace text typed before the stored drafts arrived.
            if (!next.text[draft.key]) next.text[draft.key] = draft.text
            if (draft.attachments.length) next.stale[draft.key] = draft.attachments
            if (draft.sendState === 'sending') next.uncertain[draft.key] = true
            saved.current.set(
              draft.key,
              JSON.stringify({
                text: draft.text,
                attachments: draft.attachments,
                ...(draft.sendState ? { sendState: draft.sendState } : {}),
              }),
            )
          }
          commit(next)
        }
      })
      .catch((error: Error) => {
        loaded.current = true
        errorRef.current(error.message)
      })
    const pending = timers.current
    return () => {
      cancelled = true
      for (const timer of pending.values()) clearTimeout(timer)
    }
  }, [commit])

  const schedule = useCallback(
    (key: string) => {
      if (!loaded.current) return
      clearTimeout(timers.current.get(key))
      timers.current.set(
        key,
        setTimeout(() => void persist(key), delayMs),
      )
    },
    [delayMs, persist],
  )

  const update = useCallback(
    (key: string, change: (state: DraftState) => DraftState) => {
      commit(change(latest.current))
      schedule(key)
    },
    [schedule],
  )

  return {
    state,
    notice,
    dismissNotice: () => setNotice(undefined),
    text: (key: string) => state.text[key] || '',
    attachments: (key: string) => state.attachments[key] || noAttachments,
    stale: (key: string) => state.stale[key] || noStale,
    uncertain: (key: string) => Boolean(state.uncertain[key]),
    setText: useCallback(
      (key: string, text: string) =>
        update(key, (current) => ({ ...current, text: { ...current.text, [key]: text } })),
      [update],
    ),
    appendText: useCallback(
      (key: string, text: string) =>
        update(key, (current) => {
          const existing = current.text[key] || ''
          const joined = `${existing}${existing && !/\s$/.test(existing) ? ' ' : ''}${text}`
          return { ...current, text: { ...current.text, [key]: joined } }
        }),
      [update],
    ),
    updateAttachments: useCallback(
      (key: string, change: (current: Attachment[]) => Attachment[]) =>
        update(key, (current) => ({
          ...current,
          attachments: { ...current.attachments, [key]: change(current.attachments[key] || []) },
        })),
      [update],
    ),
    dismissStale: useCallback(
      (key: string, index?: number) =>
        update(key, (current) => ({
          ...current,
          stale: {
            ...current.stale,
            [key]:
              index === undefined
                ? []
                : (current.stale[key] || []).filter((_, position) => position !== index),
          },
        })),
      [update],
    ),
    dismissUncertain: useCallback(
      (key: string) =>
        update(key, (current) => ({
          ...current,
          uncertain: { ...current.uncertain, [key]: false },
        })),
      [update],
    ),
    /** Removes every saved draft on disk and in this window. Volatile attachments stay staged in main until reload. */
    clearAll: useCallback(async () => {
      for (const timer of timers.current.values()) clearTimeout(timer)
      timers.current.clear()
      await window.muse.clearDrafts()
      saved.current.clear()
      commit(empty)
    }, [commit]),
    /** Writes a durable "sending" marker before a send so a crash cannot silently lose or replay it. */
    markSending: useCallback(
      (key: string, text: string, attachments: Attachment[]) => {
        const next = {
          ...latest.current,
          text: { ...latest.current.text, [key]: text },
          attachments: { ...latest.current.attachments, [key]: attachments },
          uncertain: { ...latest.current.uncertain, [key]: true },
        }
        latest.current = next
        return persist(key, true).then(() => {
          // The composer clears optimistically; the marker stays on disk until the outcome is known.
          const cleared = { ...latest.current, text: { ...latest.current.text, [key]: '' } }
          commit({ ...cleared, uncertain: { ...cleared.uncertain, [key]: false } })
          saved.current.set(key, JSON.stringify(draftInput(next, key)))
        })
      },
      [commit, persist],
    ),
    /** Resolves a send. Rejected and uncertain sends restore the text unless the user typed more. */
    settle: useCallback(
      (
        key: string,
        outcome: 'accepted' | 'rejected' | 'uncertain',
        text: string,
        attachments: Attachment[],
      ) => {
        {
          const current = latest.current
          const sentIds = new Set(attachments.map((file) => file.id))
          const restore = outcome !== 'accepted'
          const next: DraftState = {
            ...current,
            text: {
              ...current.text,
              [key]: restore && !current.text[key]?.trim() ? text : current.text[key] || '',
            },
            attachments: {
              ...current.attachments,
              [key]: restore
                ? [
                    ...attachments,
                    ...(current.attachments[key] || []).filter((file) => !sentIds.has(file.id)),
                  ]
                : (current.attachments[key] || []).filter((file) => !sentIds.has(file.id)),
            },
            stale: outcome === 'accepted' ? { ...current.stale, [key]: [] } : current.stale,
            uncertain: { ...current.uncertain, [key]: outcome === 'uncertain' },
          }
          commit(next)
        }
        return persist(key, true)
      },
      [commit, persist],
    ),
  }
}
