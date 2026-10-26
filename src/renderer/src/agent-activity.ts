import type { ConnectionStatus, SessionView, TranscriptItem } from '../../shared/protocol'
import { activityTitle, isInternalActivity } from './activity'

/**
 * The single "what is Muse doing" state shown in the activity strip. Every field is derived from
 * CLI-reported session state (items, pending requests, turn completion) or the desktop's own
 * connection state. Nothing here is inferred from model prose.
 */
export type AgentActivity =
  | { kind: 'idle' }
  | { kind: 'interrupted'; detail: string }
  | { kind: 'approval'; requestId: string; tool: string; target: string; count: number }
  | { kind: 'question'; requestId: string; question: string; count: number }
  | { kind: 'stopping' }
  | { kind: 'recovering'; detail: string }
  | {
      kind: 'working'
      action: 'reading' | 'command' | 'editing' | 'searching' | 'tool' | 'responding' | 'thinking'
      label: string
      detail?: string
      itemId?: string
      output?: string
    }
  | {
      kind: 'finished'
      terminal: string
      durationMs?: number
      changes: { files: number; added: number; removed: number } | null
      checks: TurnCheck[]
    }

export type TurnCheck = {
  itemId: string
  command: string
  /** Undefined when the CLI did not report an exit code (for example a tool call). */
  exitCode?: number
  exitSignal?: number
  status: string
}

const readTools = /^(read|read_?file|view|cat|open|ls|list_?dir|list_?files|glob)$/i
const searchTools = /(grep|search|find|ripgrep|rg)/i
const editTools = /(edit|write|patch|apply|create_?file|replace|str_?replace|multi_?edit)/i
const commandTools = /(shell|bash|exec|command|terminal|run)/i

function parseArgs(raw?: string): Record<string, unknown> {
  if (!raw) return {}
  try {
    const value: unknown = JSON.parse(raw)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function firstString(args: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function tail(text: string | undefined, limit = 4000) {
  if (!text) return undefined
  return text.length > limit ? `…${text.slice(-limit)}` : text
}

/** Describes one in-progress item. Returns undefined for items that should not drive the strip. */
export function describeWork(item: TranscriptItem): Extract<AgentActivity, { kind: 'working' }> {
  if (item.kind === 'agentMessage')
    return {
      kind: 'working',
      action: 'responding',
      label: 'Writing a response',
      itemId: item.itemId,
    }
  if (item.kind === 'reasoning')
    return { kind: 'working', action: 'thinking', label: 'Thinking', itemId: item.itemId }
  if (item.kind === 'userShell')
    return {
      kind: 'working',
      action: 'command',
      label: 'Running command',
      detail: item.commandText,
      itemId: item.itemId,
      output: tail(item.visibleOutput),
    }
  const tool = item.tool || ''
  const args = parseArgs(item.args)
  const path = firstString(args, ['path', 'file_path', 'filePath', 'file', 'target', 'dir'])
  const command = firstString(args, ['command', 'cmd', 'script'])
  if (item.kind === 'toolCall' && command && commandTools.test(tool))
    return {
      kind: 'working',
      action: 'command',
      label: 'Running command',
      detail: command,
      itemId: item.itemId,
      output: tail(item.visibleOutput),
    }
  if (item.kind === 'toolCall' && readTools.test(tool))
    return {
      kind: 'working',
      action: 'reading',
      label: path ? 'Reading' : `Using ${tool}`,
      detail: path,
      itemId: item.itemId,
    }
  if (item.kind === 'toolCall' && searchTools.test(tool))
    return {
      kind: 'working',
      action: 'searching',
      label: 'Searching',
      detail: firstString(args, ['pattern', 'query', 'regex']) || path,
      itemId: item.itemId,
    }
  if (item.kind === 'toolCall' && editTools.test(tool))
    return {
      kind: 'working',
      action: 'editing',
      label: path ? 'Editing' : `Using ${tool}`,
      detail: path,
      itemId: item.itemId,
    }
  return {
    kind: 'working',
    action: 'tool',
    label: item.kind === 'toolCall' ? `Using ${activityTitle(item)}` : activityTitle(item),
    detail: item.statusLine || item.fallbackText,
    itemId: item.itemId,
    output: tail(item.visibleOutput),
  }
}

function turnItems(view: SessionView, turnId?: string) {
  if (turnId) return view.items.filter((item) => item.turnId === turnId)
  // Without a turn id, fall back to everything after the last user message.
  let start = 0
  view.items.forEach((item, index) => {
    if (item.kind === 'userMessage') start = index
  })
  return view.items.slice(start)
}

/** Commands whose real exit status the CLI reported in the turn. Tool calls without an exit code are listed as such. */
export function turnChecks(items: TranscriptItem[]): TurnCheck[] {
  return items
    .filter((item) => !item.retracted && (item.kind === 'userShell' || item.kind === 'toolCall'))
    .map((item): TurnCheck | undefined => {
      if (item.kind === 'userShell')
        return {
          itemId: item.itemId,
          command: item.commandText || 'command',
          exitCode: item.exitCode,
          exitSignal: item.exitSignal,
          status: item.status,
        }
      const command = firstString(parseArgs(item.args), ['command', 'cmd', 'script'])
      if (!command || !commandTools.test(item.tool || '')) return undefined
      return {
        itemId: item.itemId,
        command,
        exitCode: item.exitCode,
        exitSignal: item.exitSignal,
        status: item.status,
      }
    })
    .filter((check) => check !== undefined)
}

export function turnChanges(items: TranscriptItem[]) {
  const patches = items.filter((item) => item.patchSummary && !item.retracted)
  if (!patches.length) return null
  return patches.reduce(
    (total, item) => ({
      files: total.files + (item.patchSummary?.files ?? 0),
      added: total.added + (item.patchSummary?.added ?? 0),
      removed: total.removed + (item.patchSummary?.removed ?? 0),
    }),
    { files: 0, added: 0, removed: 0 },
  )
}

export function deriveActivity(
  view: SessionView | null | undefined,
  connection: ConnectionStatus,
): AgentActivity {
  if (!view) return { kind: 'idle' }
  if (connection.state !== 'ready')
    return {
      kind: 'interrupted',
      detail:
        connection.state === 'connecting'
          ? 'Reconnecting to Muse Code. Nothing will be resent automatically.'
          : connection.message || 'Muse Code is not connected.',
    }
  if (view.approvals.length) {
    const approval = view.approvals[0]
    return {
      kind: 'approval',
      requestId: approval.approvalId,
      tool: approval.toolName,
      target:
        approval.subject.command ||
        approval.subject.path ||
        approval.subject.host ||
        approval.subject.target ||
        '',
      count: view.approvals.length,
    }
  }
  if (view.questions.length) {
    const request = view.questions[0]
    return {
      kind: 'question',
      requestId: request.userInputId,
      question: request.questions[0]?.question || 'Muse has a question.',
      count: view.questions.length,
    }
  }
  if (view.session.status === 'running') {
    if (view.cancelRequested) return { kind: 'stopping' }
    if (view.retry)
      return {
        kind: 'recovering',
        detail: `Model request failed (${view.retry.reason}). Muse Code is retrying: attempt ${view.retry.nextAttempt} of ${view.retry.maxAttempts}.`,
      }
    const active = view.items.filter(
      (item) => !item.retracted && item.status === 'inProgress' && !isInternalActivity(item),
    )
    const current = active[active.length - 1]
    if (current) return describeWork(current)
    return { kind: 'working', action: 'thinking', label: 'Working' }
  }
  if (view.lastTurn) {
    const items = turnItems(view, view.lastTurn.turnId)
    return {
      kind: 'finished',
      terminal: view.lastTurn.terminal,
      durationMs: view.lastTurn.durationMs,
      changes: turnChanges(items),
      checks: turnChecks(items),
    }
  }
  return { kind: 'idle' }
}

export function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** One plain-language sentence for screen-reader announcements. Never derived from streamed text. */
export function announcement(activity: AgentActivity): string {
  switch (activity.kind) {
    case 'approval':
      return `Muse is waiting for your approval to use ${activity.tool}.`
    case 'question':
      return 'Muse has a question for you.'
    case 'interrupted':
      return 'Connection to Muse Code was interrupted.'
    case 'finished':
      return activity.terminal === 'completed'
        ? 'Muse finished responding.'
        : activity.terminal === 'cancelled'
          ? 'Muse stopped.'
          : `Muse's turn ended: ${activity.terminal}.`
    default:
      return ''
  }
}
