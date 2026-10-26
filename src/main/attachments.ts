import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { Attachment, AttachmentInput } from '../shared/protocol'

export const MAX_ATTACHMENTS = 5
export const MAX_FILE_BYTES = 2 * 1024 * 1024
export const MAX_TEXT_BYTES = 200 * 1024
export const MAX_MESSAGE_BYTES = 4 * 1024 * 1024
const MAX_STAGED = 25
// Encoded payloads are larger than the raw bytes; keep the original 1.4x allowance.
const encodedSize = (bytes: number) => bytes * 1.4

type Staged = { attachment: Attachment; scope: string; data: Buffer; mediaType?: string }

function sniffImage(data: Buffer): string | undefined {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
    return 'image/png'
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)
    return 'image/jpeg'
  const head = data.subarray(0, 6).toString('latin1')
  if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif'
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString('latin1') === 'RIFF' &&
    data.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp'
  return undefined
}

function cleanName(name: string) {
  const cleaned = basename(name.replaceAll('\\', '/'))
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, 200)
  return cleaned || 'attachment'
}

export class AttachmentStore {
  private staged = new Map<string, Staged>()

  get size() {
    return this.staged.size
  }

  /** Validates every file, then stages all of them or none. Content is trusted over names. */
  stage(scope: string, files: AttachmentInput[]): Attachment[] {
    if (!files.length) return []
    const existing = [...this.staged.values()].filter((entry) => entry.scope === scope)
    if (existing.length + files.length > MAX_ATTACHMENTS)
      throw new Error(
        `You can attach up to five files per message. ${existing.length} already attached; nothing was added.`,
      )
    if (this.staged.size + files.length > MAX_STAGED)
      throw new Error('Too many pending attachments. Remove some before adding more.')
    let weight = existing.reduce((total, entry) => total + encodedSize(entry.data.length), 0)
    const prepared: Staged[] = []
    for (const file of files) {
      const name = cleanName(file.name)
      if (file.data.byteLength === 0) throw new Error(`${name} is empty.`)
      if (file.data.byteLength > MAX_FILE_BYTES)
        throw new Error(`${name} must be 2 MB or smaller.`)
      const data = Buffer.from(file.data)
      weight += encodedSize(data.length)
      if (weight > MAX_MESSAGE_BYTES)
        throw new Error('This message would exceed the 4 MB attachment limit.')
      const mediaType = sniffImage(data)
      if (!mediaType) {
        if (data.includes(0))
          throw new Error(`${name} is not a supported image or text file. Binary files are rejected.`)
        if (data.length > MAX_TEXT_BYTES) throw new Error(`${name} must be 200 KB or smaller as text.`)
        try {
          new TextDecoder('utf-8', { fatal: true }).decode(data)
        } catch {
          throw new Error(`${name} is not a supported image or text file. Binary files are rejected.`)
        }
      }
      prepared.push({
        scope,
        data,
        mediaType,
        attachment: {
          id: randomUUID(),
          name,
          kind: mediaType ? 'image' : 'text',
          size: data.length,
        },
      })
    }
    for (const entry of prepared) this.staged.set(entry.attachment.id, entry)
    return prepared.map((entry) => entry.attachment)
  }

  remove(id: string) {
    this.staged.delete(id)
  }

  clear() {
    this.staged.clear()
  }

  /** Builds SDK content for a message. Staged data is kept until `release`, so failed sends can retry. */
  build(scope: string, ids: string[], text: string) {
    const parts: Record<string, unknown>[] = [{ type: 'text', text }]
    const names: string[] = []
    let weight = Buffer.byteLength(text)
    if (new Set(ids).size !== ids.length) throw new Error('An attachment was listed twice.')
    for (const id of ids) {
      const entry = this.staged.get(id)
      if (!entry) throw new Error('An attachment expired. Select it again.')
      if (entry.scope !== scope) throw new Error('An attachment belongs to a different draft.')
      weight += encodedSize(entry.data.length)
      if (weight > MAX_MESSAGE_BYTES) throw new Error('This message exceeds the 4 MB attachment limit.')
      if (entry.mediaType)
        parts.push({
          type: 'image',
          mediaType: entry.mediaType,
          base64Data: entry.data.toString('base64'),
        })
      else
        parts.push({
          type: 'text',
          text: `Attached file: ${entry.attachment.name}\n\n${entry.data.toString('utf8')}`,
        })
      names.push(entry.attachment.name)
    }
    return { parts, display: [text, ...names.map((name) => `[Attached: ${name}]`)].join('\n') }
  }

  release(ids: string[]) {
    for (const id of ids) this.staged.delete(id)
  }
}
