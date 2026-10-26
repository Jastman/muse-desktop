import { describe, expect, it } from 'vitest'
import { isInternalActivity } from '../../src/renderer/src/activity'
import {
  promptPreview,
  stripProtocolMetadata,
  userMessageText,
} from '../../src/renderer/src/message-text'
import { sessionTitle } from '../../src/renderer/src/components/Primitives'

describe('user message text', () => {
  it('renders displayText verbatim, including HTML, XML and code', () => {
    const displayText =
      'Why does <div class="a"><span>x</span></div> collapse?\n```xml\n<config><item id="1"/></config>\n```\n<runtime_info>typed by me</runtime_info>'
    expect(userMessageText({ displayText, text: 'model-visible text' })).toBe(displayText)
  })

  it('keeps legitimate markup in raw text without displayText', () => {
    for (const text of [
      '<div>hello</div> what does this render?',
      'Use <T>(value: T) => T and Map<string, number>',
      '<template><p>{{ msg }}</p></template>',
      'fix the </div> at the end',
      '<?xml version="1.0"?><root><a>1</a></root>',
      '<script>alert(1)</script> is escaped by React',
    ]) {
      expect(userMessageText({ text })).toBe(text)
    }
  })

  it('removes only allow-listed protocol metadata at the edges of raw text', () => {
    expect(
      userMessageText({
        text: '<runtime_info>\nInternal note\n</runtime_info>\nPlease explain <b>bold</b>',
      }),
    ).toBe('Please explain <b>bold</b>')
    expect(
      stripProtocolMetadata(
        '<runtime_info><cwd>/x</cwd></runtime_info>\n<pull_request_linking>link it</pull_request_linking>\nhello',
      ),
    ).toBe('hello')
    expect(stripProtocolMetadata('hello\n<runtime_info attr="1">x</runtime_info>')).toBe('hello')
  })

  it('preserves allow-listed tag names when they appear inside the user prompt body', () => {
    const text = 'How do I parse <runtime_info>x</runtime_info> blocks in my parser?'
    expect(userMessageText({ text })).toBe(text)
  })

  it('does not remove unterminated or unknown tags', () => {
    expect(stripProtocolMetadata('<runtime_info>never closed')).toBe('<runtime_info>never closed')
    expect(stripProtocolMetadata('<context>user wrote this</context>')).toBe(
      '<context>user wrote this</context>',
    )
  })

  it('never strips look-alike tags without verified protocol provenance', () => {
    for (const tag of [
      'system-reminder',
      'environment_context',
      'user_instructions',
      'command-name',
    ]) {
      const text = `<${tag}>typed by the user</${tag}>\nPlease help`
      expect(userMessageText({ text })).toBe(text)
    }
  })

  it('falls back to raw text when displayText is empty', () => {
    expect(userMessageText({ displayText: '', text: '<p>hi</p>' })).toBe('<p>hi</p>')
  })

  it('builds titles from prompt previews without dropping markup', () => {
    expect(promptPreview('  <h1>Title</h1>\n\nbody ')).toBe('<h1>Title</h1> body')
    expect(sessionTitle({ firstUserPrompt: '<Button> props are wrong' })).toBe(
      '<Button> props are wrong',
    )
    expect(sessionTitle({ firstUserPrompt: '<runtime_info>meta</runtime_info>Real prompt' })).toBe(
      'Real prompt',
    )
  })

  it('keeps internal activity classification unchanged', () => {
    const base = { itemId: 'a', revision: 1, status: 'completed' }
    expect(isInternalActivity({ ...base, kind: 'reminderChild' })).toBe(true)
    expect(isInternalActivity({ ...base, kind: 'hookRun' })).toBe(true)
    expect(isInternalActivity({ ...base, kind: 'userMessage', text: '<hookRun/>' })).toBe(false)
    expect(isInternalActivity({ ...base, kind: 'toolCall' })).toBe(false)
  })
})
