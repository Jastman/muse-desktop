import { useEffect, useRef, useState } from 'react'
import {
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleStop,
  FileSearch,
  FileText,
  ListPlus,
  LoaderCircle,
  PencilLine,
  ShieldCheck,
  Terminal,
  WifiOff,
} from 'lucide-react'
import type { SessionView } from '../../../shared/protocol'
import { formatDuration, type AgentActivity, type TurnCheck } from '../agent-activity'
import { revealRequest } from '../navigation'

function useObservedElapsed(key: string | undefined) {
  const started = useRef<{ key?: string; at: number }>({ at: Date.now() })
  const [now, setNow] = useState(Date.now())
  if (started.current.key !== key) started.current = { key, at: Date.now() }
  useEffect(() => {
    if (!key) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [key])
  return key ? Math.max(0, now - started.current.at) : 0
}

function checkSummary(checks: TurnCheck[]) {
  if (!checks.length) return 'No commands were run in this turn.'
  const failed = checks.filter(
    (check) =>
      (check.exitCode !== undefined && check.exitCode !== 0) || check.exitSignal !== undefined,
  )
  const unknown = checks.filter(
    (check) => check.exitCode === undefined && check.exitSignal === undefined,
  )
  const parts = [`${checks.length} command${checks.length === 1 ? '' : 's'} run`]
  if (failed.length) parts.push(`${failed.length} exited with an error`)
  if (unknown.length) parts.push(`${unknown.length} without a reported exit code`)
  return `${parts.join(', ')}.`
}

const workIcons = {
  reading: FileText,
  searching: FileSearch,
  editing: PencilLine,
  command: Terminal,
  tool: LoaderCircle,
  responding: LoaderCircle,
  thinking: LoaderCircle,
}

/**
 * A persistent summary of the agent's current state, shown above the composer so it stays visible
 * while the user reads earlier messages.
 */
export function ActivityStrip({
  activity,
  queued,
  onJumpToItem,
  onReview,
}: {
  activity: AgentActivity
  queued: SessionView['queuedTurns']
  onJumpToItem: (itemId: string) => void
  onReview?: () => void
}) {
  const [showOutput, setShowOutput] = useState(false)
  const workKey =
    activity.kind === 'working' && activity.action === 'command' ? activity.itemId : undefined
  const elapsed = useObservedElapsed(workKey)
  useEffect(() => setShowOutput(false), [workKey])
  if (activity.kind === 'idle' && !queued?.length) return null
  let body: React.ReactNode = null
  let tone = 'neutral'
  if (activity.kind === 'interrupted') {
    tone = 'warning'
    body = (
      <>
        <WifiOff size={15} aria-hidden />
        <span className="activity-label">Connection interrupted</span>
        <span className="activity-detail">{activity.detail}</span>
      </>
    )
  } else if (activity.kind === 'recovering') {
    tone = 'warning'
    body = (
      <>
        <LoaderCircle size={15} className="spin" aria-hidden />
        <span className="activity-label">Recovering</span>
        <span className="activity-detail">{activity.detail}</span>
      </>
    )
  } else if (activity.kind === 'approval') {
    tone = 'attention'
    body = (
      <>
        <ShieldCheck size={15} aria-hidden />
        <span className="activity-label">Waiting for your approval</span>
        <span className="activity-detail" title={activity.target}>
          {activity.tool}
          {activity.target ? ` · ${activity.target}` : ''}
          {activity.count > 1 ? ` · ${activity.count} requests` : ''}
        </span>
        <button
          type="button"
          className="activity-action"
          onClick={() => revealRequest(activity.requestId)}
        >
          Review request
        </button>
      </>
    )
  } else if (activity.kind === 'question') {
    tone = 'attention'
    body = (
      <>
        <CircleHelp size={15} aria-hidden />
        <span className="activity-label">Muse has a question</span>
        <span className="activity-detail" title={activity.question}>
          {activity.question}
        </span>
        <button
          type="button"
          className="activity-action"
          onClick={() => revealRequest(activity.requestId)}
        >
          Answer
        </button>
      </>
    )
  } else if (activity.kind === 'stopping') {
    body = (
      <>
        <CircleStop size={15} aria-hidden />
        <span className="activity-label">Stopping</span>
        <span className="activity-detail">
          Stop requested. Waiting for Muse Code to confirm the turn has ended.
        </span>
      </>
    )
  } else if (activity.kind === 'working') {
    const Icon = workIcons[activity.action]
    body = (
      <>
        <Icon size={15} aria-hidden className={Icon === LoaderCircle ? 'spin' : ''} />
        <span className="activity-label">{activity.label}</span>
        {activity.detail && (
          <span className="activity-detail" title={activity.detail}>
            <code>{activity.detail}</code>
          </span>
        )}
        {workKey && (
          <span className="activity-meta" title="Time since Muse Desktop saw this command start">
            {formatDuration(elapsed)}
          </span>
        )}
        {activity.output !== undefined && (
          <button
            type="button"
            className="activity-action"
            aria-expanded={showOutput}
            onClick={() => setShowOutput((value) => !value)}
          >
            {showOutput ? 'Hide output' : 'Show output'}
          </button>
        )}
        {activity.itemId && (
          <button
            type="button"
            className="activity-action"
            onClick={() => onJumpToItem(activity.itemId!)}
          >
            Show in conversation
          </button>
        )}
      </>
    )
  } else if (activity.kind === 'finished') {
    const ok = activity.terminal === 'completed'
    tone = ok ? 'neutral' : 'warning'
    body = (
      <>
        {ok ? <CircleCheck size={15} aria-hidden /> : <CircleAlert size={15} aria-hidden />}
        <span className="activity-label">
          {ok
            ? 'Finished'
            : activity.terminal === 'cancelled'
              ? 'Stopped'
              : `Ended: ${activity.terminal}`}
          {activity.durationMs !== undefined ? ` in ${formatDuration(activity.durationMs)}` : ''}
        </span>
        <span className="activity-detail">
          {activity.changes
            ? `${activity.changes.files} file${activity.changes.files === 1 ? '' : 's'} changed (+${activity.changes.added} −${activity.changes.removed}). `
            : 'No file changes were reported. '}
          {checkSummary(activity.checks)}
        </span>
        {onReview && (activity.changes || activity.checks.length > 0) && (
          <button type="button" className="activity-action" onClick={onReview}>
            Review
          </button>
        )}
      </>
    )
  }
  return (
    <section className={`activity-strip ${tone}`} aria-label="Muse activity">
      {body && <div className="activity-row">{body}</div>}
      {showOutput && activity.kind === 'working' && activity.output !== undefined && (
        <pre className="activity-output" tabIndex={0} aria-label="Command output (latest lines)">
          {activity.output || 'No output yet.'}
        </pre>
      )}
      {queued && queued.length > 0 && (
        <div className="activity-row queued">
          <ListPlus size={15} aria-hidden />
          <span className="activity-label">
            {queued.length === 1 ? 'Follow-up queued' : `${queued.length} follow-ups queued`}
          </span>
          <span className="activity-detail" title={queued[0].displayText}>
            {queued[0].displayText}
          </span>
          <span className="activity-meta">Starts after the current turn</span>
        </div>
      )}
    </section>
  )
}
