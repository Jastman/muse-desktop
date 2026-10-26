import { expect, it } from 'vitest'
import { isInternalActivity, isBackgroundOnly } from '../../src/renderer/src/activity'
import { cleanPromptText, sessionTitle } from '../../src/renderer/src/components/Primitives'
import { userMessageText } from '../../src/renderer/src/message-text'
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

it('strips harness metadata tags from conversation titles and user messages', () => {
  const withTags =
    '<runtime_info>Working directory: /tmp</runtime_info><pull_request_linking>Call link_pull_request</pull_request_linking>Review the Harness Terminal architecture.'
  expect(cleanPromptText(withTags)).toBe('Review the Harness Terminal architecture.')
  expect(
    sessionTitle({
      firstUserPrompt:
        'truncated prefix...</pull_request_linking>I want you to do a thorough dive on this Harness Terminal.',
    }),
  ).toBe('I want you to do a thorough dive on this Harness Terminal.')
  expect(
    userMessageText({
      text: '<system-reminder>Internal note</system-reminder>First line\nSecond line',
    }),
  ).toBe('First line\nSecond line')
  expect(sessionTitle({ firstUserPrompt: '<runtime_info>unclosed metadata only' })).toBe(
    'Untitled conversation',
  )
})
