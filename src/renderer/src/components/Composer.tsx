import { useEffect, useRef, useState } from 'react'
import {
  ArrowUp,
  AudioLines,
  FileCode2,
  FileText,
  Folder,
  Image,
  Paperclip,
  Square,
  X,
} from 'lucide-react'
import {
  attachmentLimits,
  type Attachment,
  type MuseModel,
  type Preferences,
  type ProjectFile,
  type ReasoningEffort,
  type StoredDraft,
} from '../../../shared/protocol'
import { effortCapability } from '../capabilities'
import { IconButton } from './Primitives'
import { Select } from './Select'
import { VoiceInput } from './VoiceInput'
import { composerCommands, parseComposerCommand } from '../commands'

export type SendState = {
  key: string
  phase: 'sending' | 'accepted' | 'rejected' | 'uncertain'
  disposition?: string
  message?: string
}

const followUpOptions = [
  {
    value: 'queue',
    label: 'Queue next',
    description: 'Waits, then runs as a new turn after Muse finishes the current one.',
  },
  {
    value: 'steer',
    label: 'Steer now',
    description: 'Adds your message to the current turn so Muse can change course.',
  },
]

export function formatBytes(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`
  return `${Math.round(size / 104857.6) / 10} MB`
}

function sendStatusText(state: SendState | undefined, running: boolean) {
  if (!state) return ''
  if (state.phase === 'sending') return 'Sending…'
  if (state.phase === 'rejected') return 'Not sent. Your draft was restored.'
  if (state.phase === 'uncertain') return ''
  if (state.disposition === 'queued')
    return 'Queued. Muse will start it after the current turn finishes.'
  if (state.disposition === 'steered') return 'Delivered to the running turn.'
  return running ? 'Accepted. Muse is working.' : 'Accepted.'
}

export function Composer({
  draft,
  setDraft,
  running,
  backgroundOnly,
  submitting,
  connected,
  hasProject,
  project,
  models,
  modelId,
  preferences,
  onModel,
  onEffort,
  draftKey,
  attachments,
  onAttachments,
  onVoiceText,
  staleAttachments = [],
  onDismissStale = () => {},
  uncertainSend = false,
  onDismissUncertain = () => {},
  sendState,
  cancelRequested = false,
  onSubmit,
  onCancel,
  onError,
}: {
  draft: string
  setDraft: (value: string) => void
  running: boolean
  backgroundOnly: boolean
  submitting: boolean
  connected: boolean
  hasProject: boolean
  project?: string
  models: MuseModel[]
  modelId: string
  preferences: Preferences
  onModel: (id: string) => void
  onEffort: (effort: ReasoningEffort) => void
  draftKey: string
  attachments: Attachment[]
  onAttachments: (key: string, update: (current: Attachment[]) => Attachment[]) => void
  onVoiceText: (key: string, text: string) => void
  staleAttachments?: StoredDraft['attachments']
  onDismissStale?: (index?: number) => void
  uncertainSend?: boolean
  onDismissUncertain?: () => void
  sendState?: SendState
  cancelRequested?: boolean
  onSubmit: (attachments: Attachment[], mode: 'queue' | 'steer') => Promise<boolean>
  onCancel: () => void
  onError: (message: string) => void
}) {
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [commandIndex, setCommandIndex] = useState(0)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionFiles, setMentionFiles] = useState<ProjectFile[]>([])
  const [dragging, setDragging] = useState(false)
  // Object URLs for image thumbnails of files the renderer already holds (drop/paste).
  const thumbnails = useRef(new Map<string, string>())
  const [, setThumbnailVersion] = useState(0)
  useEffect(() => {
    const live = new Set(attachments.map((file) => file.id))
    for (const [id, url] of thumbnails.current)
      if (!live.has(id)) {
        URL.revokeObjectURL(url)
        thumbnails.current.delete(id)
      }
  }, [attachments])
  useEffect(() => {
    const urls = thumbnails.current
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url)
      urls.clear()
    }
  }, [])
  const currentModel = models.find((model) => model.modelId === modelId)
  const effort = effortCapability(currentModel, preferences.reasoningEffort)
  const statusText = sendStatusText(sendState, running)
  const suggestions = /^\/[a-z-]*$/i.test(draft)
    ? composerCommands.filter((command) => command.name.startsWith(draft.slice(1).toLowerCase()))
    : []
  const mentionMatch = project ? /(?:^|\s)@([^\s@]*)$/.exec(draft) : null
  const mentionToken = mentionMatch ? mentionMatch[1] : null
  const mentionDir =
    mentionToken && mentionToken.includes('/')
      ? mentionToken.slice(0, mentionToken.lastIndexOf('/'))
      : ''
  const mentionFilter =
    mentionToken !== null
      ? (mentionToken.includes('/')
          ? mentionToken.slice(mentionToken.lastIndexOf('/') + 1)
          : mentionToken
        ).toLowerCase()
      : ''
  useEffect(() => {
    if (!project || mentionToken === null) {
      setMentionFiles([])
      return
    }
    let cancelled = false
    void window.muse
      .listFiles(project, mentionDir)
      .then((entries) => {
        if (!cancelled) setMentionFiles(entries)
      })
      .catch(() => {
        if (!cancelled) setMentionFiles([])
      })
    return () => {
      cancelled = true
    }
  }, [project, mentionDir, mentionToken !== null])
  const mentionSuggestions =
    mentionToken !== null
      ? mentionFiles
          .filter((entry) => entry.name.toLowerCase().includes(mentionFilter))
          .slice(0, 12)
      : []
  const isCommand = Boolean(parseComposerCommand(draft))
  const chooseCommand = (name: string) => {
    setDraft(`/${name} `)
    textarea.current?.focus()
  }
  const chooseMention = (entry: ProjectFile) => {
    if (mentionToken === null) return
    const prefix = draft.slice(0, draft.length - mentionToken.length - 1)
    setDraft(`${prefix}@${entry.path}${entry.directory ? '/' : ' '}`)
    textarea.current?.focus()
  }
  useEffect(() => {
    setCommandIndex(0)
    setMentionIndex(0)
  }, [draft])
  const [mode, setMode] = useState<'queue' | 'steer'>('queue')
  const textarea = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (textarea.current) {
      textarea.current.style.height = 'auto'
      textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 200)}px`
    }
  }, [draft])
  const submit = async () => {
    if (
      voiceBusy ||
      submitting ||
      (!connected && !isCommand) ||
      (!draft.trim() && !attachments.length)
    )
      return
    await onSubmit(attachments, mode)
  }
  const addFiles = async (files: File[]) => {
    const key = draftKey
    try {
      if (files.length > attachmentLimits.count)
        throw new Error(`You can attach up to ${attachmentLimits.count} files per message.`)
      const large = files.find((file) => file.size > attachmentLimits.fileBytes)
      if (large) throw new Error(`${large.name || 'This file'} must be 2 MB or smaller.`)
      const inputs = await Promise.all(
        files.map(async (file) => {
          const name = file.name || 'pasted-image'
          try {
            return { name, data: new Uint8Array(await file.arrayBuffer()) }
          } catch {
            throw new Error(
              `Could not read ${name}. Folders and unreadable files cannot be attached.`,
            )
          }
        }),
      )
      const added = await window.muse.stageAttachments(key, inputs)
      added.forEach((attachment, index) => {
        const file = files[index]
        if (attachment.kind === 'image' && file?.type.startsWith('image/'))
          thumbnails.current.set(attachment.id, URL.createObjectURL(file))
      })
      setThumbnailVersion((version) => version + 1)
      onAttachments(key, (current) => [...current, ...added])
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    }
  }
  const attach = async () => {
    const key = draftKey
    try {
      const files = await window.muse.chooseAttachments(key)
      onAttachments(key, (current) => [...current, ...files])
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    }
  }
  return (
    <div className="composer-wrap">
      {suggestions.length > 0 && (
        <div
          className="slash-menu"
          role="listbox"
          id="composer-commands"
          aria-label="Composer commands"
        >
          {suggestions.map((command, index) => (
            <button
              type="button"
              role="option"
              id={`command-${command.name}`}
              key={command.name}
              aria-selected={index === commandIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseCommand(command.name)}
            >
              <strong>/{command.name}</strong>
              <span>{command.description}</span>
            </button>
          ))}
        </div>
      )}
      {mentionSuggestions.length > 0 && (
        <div
          className="slash-menu mention-menu"
          role="listbox"
          id="composer-mentions"
          aria-label="Project files"
        >
          {mentionSuggestions.map((entry, index) => (
            <button
              type="button"
              role="option"
              id={`mention-${entry.path}`}
              key={entry.path}
              aria-selected={index === mentionIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseMention(entry)}
            >
              {entry.directory ? <Folder size={14} /> : <FileCode2 size={14} />}
              <strong>{entry.path}</strong>
              <span>{entry.directory ? 'Folder' : 'File'}</span>
            </button>
          ))}
        </div>
      )}
      <div className={`sidebar-collapse ${running ? 'open' : ''}`}>
        <div className="sidebar-collapse-inner">
          <div className="running-line">
            <span className="working-orb" />
            <span>
              {cancelRequested
                ? 'Stopping — waiting for Muse to confirm'
                : backgroundOnly
                  ? 'Finishing background tasks'
                  : 'Muse is working'}
              <span className="animated-dots">…</span>
            </span>
            <span className="running-hint">
              {cancelRequested
                ? 'The stop request was accepted. Work may continue briefly.'
                : 'Send a follow-up to queue it or steer this turn.'}
            </span>
          </div>
        </div>
      </div>
      <form
        className={`composer ${running ? 'is-running' : ''} ${dragging ? 'is-dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          if (!dragging) setDragging(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          const dropped = Array.from(event.dataTransfer.files)
          if (dropped.length) void addFiles(dropped)
        }}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {uncertainSend && (
          <div className="composer-notice warning" role="status">
            <span>
              {sendState?.phase === 'uncertain' && sendState.message
                ? sendState.message
                : 'This message may already have been sent before Muse Desktop closed or lost its connection. Check the conversation before sending it again.'}
            </span>
            <button type="button" onClick={onDismissUncertain}>
              Dismiss
            </button>
          </div>
        )}
        {staleAttachments.length > 0 && (
          <div className="attachment-list" aria-label="Attachments to reattach">
            {staleAttachments.map((file, index) => (
              <span className="attachment stale" key={`${file.name}-${index}`}>
                {file.kind === 'image' ? <Image size={14} /> : <FileText size={14} />}
                <span>{file.name}</span>
                <small>{formatBytes(file.size)} · not attached — add it again to include it</small>
                <button
                  type="button"
                  aria-label={`Dismiss ${file.name}`}
                  onClick={() => onDismissStale(index)}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="attachment-list" aria-label="Attached files">
            {attachments.map((file) => (
              <span className="attachment" key={file.id}>
                {thumbnails.current.get(file.id) ? (
                  <img
                    className="attachment-thumbnail"
                    src={thumbnails.current.get(file.id)}
                    alt=""
                    width={28}
                    height={28}
                  />
                ) : file.kind === 'image' ? (
                  <Image size={14} />
                ) : (
                  <FileText size={14} />
                )}
                <span>{file.name}</span>
                <small>
                  {formatBytes(file.size)} · {file.kind === 'image' ? 'image' : 'text'} · included
                  when sent
                </small>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => {
                    void window.muse
                      .removeAttachment(file.id)
                      .catch((error: Error) => onError(error.message))
                    onAttachments(draftKey, (current) =>
                      current.filter((entry) => entry.id !== file.id),
                    )
                  }}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={textarea}
          aria-label="Message Muse"
          aria-controls={suggestions.length ? 'composer-commands' : undefined}
          aria-activedescendant={
            suggestions[commandIndex] ? `command-${suggestions[commandIndex].name}` : undefined
          }
          placeholder={hasProject ? 'Ask Muse about your project…' : 'Ask Muse anything…'}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onPaste={(event) => {
            const images = Array.from(event.clipboardData.files).filter((file) =>
              file.type.startsWith('image/'),
            )
            if (!images.length || event.clipboardData.types.includes('text/plain')) return
            event.preventDefault()
            void addFiles(images)
          }}
          rows={2}
          spellCheck
          onKeyDown={(event) => {
            if (suggestions.length && !event.nativeEvent.isComposing) {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                const next =
                  (commandIndex + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) %
                  suggestions.length
                setCommandIndex(next)
                document
                  .getElementById(`command-${suggestions[next].name}`)
                  ?.scrollIntoView({ block: 'nearest' })
                return
              }
              if (
                event.key === 'Tab' ||
                (event.key === 'Enter' &&
                  !event.shiftKey &&
                  !composerCommands.some((entry) => `/${entry.name}` === draft.toLowerCase()))
              ) {
                event.preventDefault()
                chooseCommand(suggestions[commandIndex].name)
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setDraft(`${draft} `)
                return
              }
            }
            if (mentionSuggestions.length && !event.nativeEvent.isComposing) {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                const next =
                  (mentionIndex +
                    (event.key === 'ArrowDown' ? 1 : -1) +
                    mentionSuggestions.length) %
                  mentionSuggestions.length
                setMentionIndex(next)
                document
                  .getElementById(`mention-${mentionSuggestions[next].path}`)
                  ?.scrollIntoView({ block: 'nearest' })
                return
              }
              if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
                event.preventDefault()
                chooseMention(mentionSuggestions[mentionIndex])
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setMentionFiles([])
                return
              }
            }
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void submit()
            }
          }}
        />
        <div className="composer-toolbar">
          <div className="composer-tools">
            <IconButton
              label="Attach images or text files"
              disabled={submitting}
              onClick={() => {
                void attach()
              }}
            >
              <Paperclip size={17} />
            </IconButton>
            <span className="toolbar-divider" />
            <VoiceInput
              disabled={submitting || !connected}
              onBusy={setVoiceBusy}
              onError={onError}
              scope={draftKey}
              onText={(text, scope) => {
                onVoiceText(scope, text)
                textarea.current?.focus()
              }}
            />
            <Select
              label="Model"
              className="model-select"
              value={modelId}
              disabled={submitting || models.length === 0}
              onChange={onModel}
              icon={<span className="model-spark">✳</span>}
              options={[
                ...(!models.some((model) => model.modelId === modelId)
                  ? [{ value: modelId, label: modelId || 'CLI default' }]
                  : []),
                ...models.map((model) => ({
                  value: model.modelId,
                  label: model.displayLabel || model.modelId,
                })),
              ]}
            />
            <Select
              label="Reasoning effort"
              className={`effort-select ${effort.warning ? 'has-warning' : ''}`}
              value={preferences.reasoningEffort}
              onChange={(value) => onEffort(value as ReasoningEffort)}
              icon={<AudioLines size={15} className="effort-icon" />}
              note={effort.note}
              options={effort.options}
            />
          </div>
          <div className="composer-actions">
            {running && (
              <>
                <Select
                  label="Follow-up behavior"
                  value={mode}
                  onChange={(value) => setMode(value as 'queue' | 'steer')}
                  note="Muse is still working on the current turn."
                  options={followUpOptions}
                />
                <IconButton label="Stop Muse" onClick={onCancel}>
                  <Square size={14} fill="currentColor" />
                </IconButton>
              </>
            )}
            <button
              className="send-button"
              type="submit"
              aria-label={running ? 'Send follow-up' : 'Send message'}
              disabled={
                voiceBusy ||
                submitting ||
                (!connected && !isCommand) ||
                (!draft.trim() && !attachments.length)
              }
            >
              {submitting ? <span className="spinner" /> : <ArrowUp size={19} strokeWidth={2.2} />}
            </button>
          </div>
        </div>
      </form>
      {effort.warning && (
        <p className="composer-warning" role="status">
          {effort.warning}
        </p>
      )}
      <div className="composer-footnote">
        <span className="send-status" role="status" aria-live="polite">
          {statusText}
          {sendState?.phase === 'rejected' && sendState.message ? ` ${sendState.message}` : ''}
        </span>
        <span>{hasProject ? '' : 'Select a project when you send your first message.'}</span>
        <span className="composer-shortcuts">
          <span className="composer-shortcut">
            <kbd>↵</kbd>
            <span>Send</span>
          </span>
          <span className="footnote-dot" aria-hidden="true">
            ·
          </span>
          <span className="composer-shortcut">
            <kbd>⇧</kbd>
            <kbd>↵</kbd>
            <span>New line</span>
          </span>
        </span>
      </div>
    </div>
  )
}
