import { describe, expect, it } from 'vitest'
import { AttachmentStore } from '../../src/main/attachments'

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])
const text = (value: string) => new Uint8Array(Buffer.from(value))

describe('attachment store', () => {
  it('turns every input path into the same SDK image and text payloads', () => {
    const store = new AttachmentStore()
    // The same bytes arrive from the picker, a drop, or a paste; the path is irrelevant.
    const [picked] = store.stage('a', [{ name: 'shot.png', data: png }])
    const [dropped] = store.stage('b', [{ name: 'other-name.bin', data: png }])
    expect(picked.kind).toBe('image')
    expect(dropped.kind).toBe('image')
    const one = store.build('a', [picked.id], 'look')
    const two = store.build('b', [dropped.id], 'look')
    expect(one.parts).toEqual(two.parts)
    expect(one.parts[1]).toEqual({
      type: 'image',
      mediaType: 'image/png',
      base64Data: Buffer.from(png).toString('base64'),
    })
    const [note] = store.stage('a', [{ name: 'notes.md', data: text('héllo') }])
    expect(store.build('a', [note.id], 'x').parts[1]).toEqual({
      type: 'text',
      text: 'Attached file: notes.md\n\nhéllo',
    })
    expect(store.build('a', [picked.id, note.id], 'x').display).toBe(
      'x\n[Attached: shot.png]\n[Attached: notes.md]',
    )
  })

  it('trusts content over the file name', () => {
    const store = new AttachmentStore()
    expect(store.stage('a', [{ name: 'photo.txt', data: jpeg }])[0].kind).toBe('image')
    expect(() => store.stage('a', [{ name: 'fake.png', data: new Uint8Array([0, 1, 2]) }])).toThrow(
      /Binary/,
    )
    expect(() =>
      store.stage('a', [{ name: 'bad.txt', data: new Uint8Array([0xc3, 0x28]) }]),
    ).toThrow(/not a supported/)
    expect(() => store.stage('a', [{ name: 'empty.txt', data: new Uint8Array() }])).toThrow(/empty/)
  })

  it('rejects oversized files and text explicitly', () => {
    const store = new AttachmentStore()
    expect(() =>
      store.stage('a', [{ name: 'big.txt', data: text('x'.repeat(200 * 1024 + 1)) }]),
    ).toThrow(/200 KB/)
    expect(() =>
      store.stage('a', [{ name: 'huge.png', data: new Uint8Array(2 * 1024 * 1024 + 1) }]),
    ).toThrow(/2 MB/)
    expect(store.size).toBe(0)
  })

  it('enforces the count and aggregate limits atomically', () => {
    const store = new AttachmentStore()
    store.stage(
      'a',
      [1, 2, 3, 4].map((n) => ({ name: `${n}.txt`, data: text('hi') })),
    )
    expect(() =>
      store.stage('a', [
        { name: '5.txt', data: text('hi') },
        { name: '6.txt', data: text('hi') },
      ]),
    ).toThrow(/up to five/)
    expect(store.size).toBe(4)
    const big = new Uint8Array([...png, ...new Uint8Array(1_500_000)])
    store.clear()
    store.stage('a', [{ name: '1.png', data: big }])
    expect(() => store.stage('a', [{ name: '2.png', data: big }])).toThrow(/4 MB/)
    expect(store.size).toBe(1)
    const [first] = store.stage('b', [{ name: '3.png', data: big }])
    expect(() => store.build('b', [first.id], 'x'.repeat(2_300_000))).toThrow(/4 MB/)
  })

  it('isolates drafts and keeps attachments for retry until released', () => {
    const store = new AttachmentStore()
    const [file] = store.stage('draft-1', [{ name: 'a.txt', data: text('a') }])
    expect(() => store.build('draft-2', [file.id], 'x')).toThrow(/different draft/)
    expect(() => store.build('draft-1', [file.id, file.id], 'x')).toThrow(/twice/)
    // A failed send builds the payload but never releases it.
    store.build('draft-1', [file.id], 'x')
    expect(store.build('draft-1', [file.id], 'x').parts).toHaveLength(2)
    store.release([file.id])
    expect(() => store.build('draft-1', [file.id], 'x')).toThrow(/expired/)
    const [removed] = store.stage('draft-1', [{ name: 'b.txt', data: text('b') }])
    store.remove(removed.id)
    expect(store.size).toBe(0)
  })

  it('sanitizes names', () => {
    const store = new AttachmentStore()
    expect(store.stage('a', [{ name: '../../etc/pass\nwd', data: text('x') }])[0].name).toBe(
      'pass wd',
    )
  })
})
