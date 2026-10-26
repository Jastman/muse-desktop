import { describe, expect, it } from 'vitest'
import { DiagnosticsLog, redact } from '../../src/main/diagnostics'

const GH = ['ghp', '_', 'a'.repeat(30)].join('')
const PW = 'hunter2' + 'xyz'
const ctx = { appVersion: '0.3.0-rc.1', platform: 'linux', arch: 'x64' }

describe('diagnostics redaction', () => {
  it('removes secret-like strings and home paths', () => {
    const text =
      `failed: token=${GH} key sk-live_1234567890abcd ` +
      'Authorization: Bearer ' +
      PW +
      ' at /Users/alice/work/app and C:\\Users\\bob\\proj ' +
      'AKIAABCDEFGHIJKLMNOP'
    const out = redact(text, '/home/runner')
    expect(out).not.toMatch(/ghp_|sk-live|hunter2|alice|bob|AKIA/)
    expect(out).not.toContain(GH)
    expect(out).toContain('/~user/work/app')
  })

  it('redacts the actual home directory and private keys', () => {
    const out = redact(
      '/home/carol/x -----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----',
      '/home/carol',
    )
    expect(out).not.toMatch(/carol|MIIabc/)
  })
})

describe('diagnostics log', () => {
  it('records nothing unless explicitly enabled', () => {
    const log = new DiagnosticsLog({ enabled: () => false })
    log.record({ kind: 'error', name: 'x' })
    expect(log.size()).toBe(0)
  })

  it('is bounded, expires old events, clears, and exports only redacted text', () => {
    let now = Date.parse('2026-01-01T00:00:00Z')
    const log = new DiagnosticsLog({
      enabled: () => true,
      maxEvents: 3,
      retentionMs: 1000,
      now: () => now,
    })
    for (let i = 0; i < 5; i++) log.record({ kind: 'timing', name: `t${i}`, durationMs: i })
    expect(log.size()).toBe(3)
    log.record({ kind: 'error', name: 'boom', detail: 'password=' + PW + ' in /Users/dan/x' })
    const exported = log.previewExport(ctx)
    expect(exported).not.toMatch(/hunter2|dan/)
    expect(JSON.parse(exported).events.at(-1).name).toBe('boom')
    now += 5000
    expect(JSON.parse(log.previewExport(ctx)).events).toHaveLength(0)
    log.record({ kind: 'lifecycle', name: 'again' })
    log.clear()
    expect(log.size()).toBe(0)
  })
})
