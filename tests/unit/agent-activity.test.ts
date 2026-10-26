import { describe, expect, it } from 'vitest'
import {
  announcement,
  deriveActivity,
  describeWork,
  turnChecks,
} from '../../src/renderer/src/agent-activity'
import type { ConnectionStatus, SessionView, TranscriptItem } from '../../src/shared/protocol'

const ready: ConnectionStatus = { state: 'ready' }
const item = (patch: Partial<TranscriptItem>): TranscriptItem => ({
  itemId: Math.random().toString(36).slice(2),
  kind: 'toolCall',
  revision: 1,
  status: 'completed',
  ...patch,
})
const view = (patch: Partial<SessionView> = {}, status = 'idle'): SessionView => ({
  session: {
    sessionId: 's1',
    workspaceRoot: '/p',
    createdAt: '',
    updatedAt: '',
    status,
    activeTurnId: status === 'running' ? 't1' : null,
    modelId: null,
    turnCount: 1,
  },
  items: [],
  approvals: [],
  questions: [],
  ...patch,
})

describe('deriveActivity', () => {
  it('is idle without a conversation or turn information', () => {
    expect(deriveActivity(undefined, ready)).toEqual({ kind: 'idle' })
    expect(deriveActivity(view(), ready)).toEqual({ kind: 'idle' })
  })

  it('reports connection interruption before anything else and never promises a resend', () => {
    const activity = deriveActivity(view({}, 'running'), { state: 'connecting' })
    expect(activity.kind).toBe('interrupted')
    expect(activity.kind === 'interrupted' && activity.detail).toMatch(/Nothing will be resent/)
  })

  it('prioritizes pending approvals and questions with their request ids', () => {
    const approval = {
      approvalId: 'a1',
      sessionId: 's1',
      toolName: 'shell',
      rawArgs: '{}',
      currentRequirementId: { approvalId: 'a1', sourceIndex: 0 },
      subject: { kind: 'command', command: 'rm -rf build' },
      availableChoices: [],
    }
    const activity = deriveActivity(view({ approvals: [approval] }, 'running'), ready)
    expect(activity).toMatchObject({ kind: 'approval', requestId: 'a1', target: 'rm -rf build' })
    expect(announcement(activity)).toMatch(/approval/)
    const question = deriveActivity(
      view(
        {
          questions: [
            {
              userInputId: 'q1',
              sessionId: 's1',
              questions: [
                {
                  id: 'x',
                  header: 'h',
                  question: 'Which file?',
                  options: [],
                  selection: { mode: 'single' },
                },
              ],
            },
          ],
        },
        'running',
      ),
      ready,
    )
    expect(question).toMatchObject({ kind: 'question', requestId: 'q1', question: 'Which file?' })
  })

  it('distinguishes stop requested from stopped', () => {
    expect(deriveActivity(view({ cancelRequested: true }, 'running'), ready).kind).toBe('stopping')
    const stopped = deriveActivity(
      view({ lastTurn: { turnId: 't1', terminal: 'cancelled' } }),
      ready,
    )
    expect(stopped.kind).toBe('finished')
    expect(announcement(stopped)).toBe('Muse stopped.')
  })

  it('shows a scheduled model retry as recovering', () => {
    const activity = deriveActivity(
      view(
        {
          retry: {
            nextAttempt: 2,
            maxAttempts: 3,
            retryDelayMs: 1000,
            reason: 'rate limited',
            receivedAt: 0,
          },
        },
        'running',
      ),
      ready,
    )
    expect(activity).toMatchObject({ kind: 'recovering' })
    expect(activity.kind === 'recovering' && activity.detail).toMatch(/attempt 2 of 3/)
  })

  it('describes the latest in-progress visible item', () => {
    const running = view(
      {
        items: [
          item({ kind: 'reminderChild', status: 'inProgress' }),
          item({
            itemId: 'r',
            tool: 'read_file',
            args: '{"path":"src/App.tsx"}',
            status: 'inProgress',
          }),
        ],
      },
      'running',
    )
    expect(deriveActivity(running, ready)).toMatchObject({
      kind: 'working',
      action: 'reading',
      detail: 'src/App.tsx',
      itemId: 'r',
    })
    expect(
      describeWork(item({ kind: 'userShell', commandText: 'npm test', visibleOutput: 'ok' })),
    ).toMatchObject({ action: 'command', detail: 'npm test', output: 'ok' })
    expect(describeWork(item({ tool: 'mystery', args: 'not json' }))).toMatchObject({
      action: 'tool',
      label: 'Using mystery',
    })
  })

  it('summarizes the finished turn only from reported exit codes and patch summaries', () => {
    const finished = deriveActivity(
      view({
        lastTurn: { turnId: 't1', terminal: 'completed', durationMs: 65000 },
        items: [
          item({ turnId: 't0', kind: 'userShell', commandText: 'old', exitCode: 1 }),
          item({ turnId: 't1', kind: 'userShell', commandText: 'npm test', exitCode: 1 }),
          item({ turnId: 't1', tool: 'bash', args: '{"command":"npm run lint"}' }),
          item({ turnId: 't1', tool: 'edit', patchSummary: { files: 2, added: 5, removed: 1 } }),
        ],
      }),
      ready,
    )
    expect(finished).toMatchObject({
      kind: 'finished',
      changes: { files: 2, added: 5, removed: 1 },
    })
    if (finished.kind !== 'finished') throw new Error('expected finished')
    expect(finished.checks).toHaveLength(2)
    expect(finished.checks[0]).toMatchObject({ command: 'npm test', exitCode: 1 })
    // A tool call without an exit code is never presented as passing.
    expect(finished.checks[1].exitCode).toBeUndefined()
  })

  it('ignores retracted items and non-command tools when listing checks', () => {
    expect(
      turnChecks([
        item({ kind: 'userShell', commandText: 'x', retracted: true }),
        item({ tool: 'read_file', args: '{"path":"a"}' }),
      ]),
    ).toEqual([])
  })
})
