/**
 * User-message presentation.
 *
 * `displayText` is the client-supplied presentation form of a prompt (MSP tdd SS3.2): it is
 * durable, never model-visible and never contains injected context, so it is rendered verbatim.
 *
 * Only when a message has no `displayText` (for example prompts typed in the terminal CLI) may the
 * raw `text` carry protocol metadata that the CLI or a hook prepended. In that case we remove only
 * complete, explicitly allow-listed metadata blocks that appear at the very start or end of the
 * text. Any other markup — HTML, XML, JSX, generics, code — is user content and is preserved.
 */
export const injectedMetadataTags = [
  'runtime_info',
  'pull_request_linking',
  'system-reminder',
  'system_reminder',
  'environment_context',
  'environment-context',
  'user_instructions',
  'user-instructions',
  'muse-context',
  'muse_context',
  'command-name',
  'command-message',
  'command-args',
  'local-command-stdout',
  'local-command-stderr',
] as const

const tagPattern = injectedMetadataTags
  .map((tag) => tag.replace(/[-_]/g, (char) => `\\${char}`))
  .join('|')
const leadingBlock = new RegExp(`^\\s*<(${tagPattern})(?:\\s[^<>]*)?>[\\s\\S]*?</\\1\\s*>`)
const trailingBlock = new RegExp(
  `<(${tagPattern})(?:\\s[^<>]*)?>(?:(?!<\\1[\\s>])[\\s\\S])*?</\\1\\s*>\\s*$`,
)

export function stripProtocolMetadata(value?: string) {
  if (!value) return ''
  let text = value
  for (let i = 0; i < 16; i++) {
    const next = text.replace(leadingBlock, '').replace(trailingBlock, '')
    if (next === text) break
    text = next
  }
  return text.trim()
}

export function userMessageText(item: { displayText?: string; text?: string }) {
  if (item.displayText !== undefined && item.displayText !== '') return item.displayText
  return stripProtocolMetadata(item.text)
}

const truncatedPrefix = new RegExp(
  `^(?:(?!<(?:${tagPattern})[\\s>])[\\s\\S])*?</(${tagPattern})\\s*>`,
)
const unterminatedOnly = new RegExp(`^\\s*<(${tagPattern})(?:\\s[^<>]*)?>(?:(?!</\\1)[\\s\\S])*$`)

/**
 * One-line preview for titles. `firstUserPrompt`/titles may be cut at a length budget, so a
 * metadata block can lose its opening or closing tag; only allow-listed tag names are treated so.
 */
export function promptPreview(value?: string) {
  let text = stripProtocolMetadata(value)
  for (let i = 0; i < 16; i++) {
    const next = stripProtocolMetadata(
      text.replace(truncatedPrefix, '').replace(unterminatedOnly, ''),
    )
    if (next === text) break
    text = next
  }
  return text.replace(/\s+/g, ' ').trim()
}
