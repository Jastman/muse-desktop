import { expect, it } from 'vitest'
import { isInternalActivity, isBackgroundOnly } from '../../src/renderer/src/activity'
import type { TranscriptItem } from '../../src/shared/protocol'

it('moves CLI bookkeeping out of chat without hiding tools, delegated work, or failed results', () => {
  const item = (kind: string, status = 'inProgress'): TranscriptItem => ({
    kind,
    status,
    revision: 1,
    itemId: kind,
  })
  expect(isInternalActivity(item('reminderChild'))).toBe(true)
  expect(isInternalActivity(item('hookRun'))).toBe(true)
  for (const kind of ['toolCall', 'subagent', 'workflow', 'userShell', 'webSearch'])
    expect(isInternalActivity(item(kind, 'failed'))).toBe(false)
  expect(isBackgroundOnly([item('reminderChild'), item('agentMessage', 'completed')])).toBe(true)
  expect(isBackgroundOnly([item('reminderChild'), item('toolCall')])).toBe(false)
  expect(isBackgroundOnly([])).toBe(false)
})
