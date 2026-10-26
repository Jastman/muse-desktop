import { homedir } from 'node:os'

/**
 * Local, opt-in diagnostics primitives. Nothing here performs I/O or network access: a caller
 * records bounded events in memory, previews the REDACTED export, and decides whether to save it.
 * Prompts, code, file contents and audio are never accepted as event fields (only a fixed schema).
 */
export type DiagnosticEvent = {
  at: string
  kind: 'connection' | 'error' | 'timing' | 'lifecycle'
  name: string
  durationMs?: number
  detail?: string
}

const SECRET_PATTERNS: RegExp[] = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /(?<=\b(?:api[_-]?key|token|secret|password|passwd|authorization)["']?\s*[:=]\s*["']?)[^\s"',;&]{4,}/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
]

export function redact(value: string, home = homedir()): string {
  let text = value
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, '[redacted]')
  if (home && home.length > 1) text = text.split(home).join('~')
  text = text.replace(/\/(?:Users|home)\/[^/\s"']+/g, '/~user')
  text = text.replace(/[A-Za-z]:\\Users\\[^\\\s"']+/g, 'C:\\Users\\~user')
  return text
}

export class DiagnosticsLog {
  private events: DiagnosticEvent[] = []

  constructor(
    private readonly options: {
      enabled: () => boolean
      maxEvents?: number
      retentionMs?: number
      now?: () => number
    },
  ) {}

  private now() {
    return this.options.now?.() ?? Date.now()
  }

  record(event: Omit<DiagnosticEvent, 'at'>) {
    if (!this.options.enabled()) return
    const at = new Date(this.now()).toISOString()
    this.events.push({
      at,
      kind: event.kind,
      name: event.name.slice(0, 80),
      ...(typeof event.durationMs === 'number' && Number.isFinite(event.durationMs)
        ? { durationMs: Math.round(event.durationMs) }
        : {}),
      ...(event.detail ? { detail: event.detail.slice(0, 300) } : {}),
    })
    this.prune()
  }

  private prune() {
    const cutoff = this.now() - (this.options.retentionMs ?? 7 * 24 * 3600_000)
    this.events = this.events.filter((event) => Date.parse(event.at) >= cutoff)
    const max = this.options.maxEvents ?? 500
    if (this.events.length > max) this.events = this.events.slice(-max)
  }

  clear() {
    this.events = []
  }

  size() {
    return this.events.length
  }

  /** The exact text a user would review and choose to share; already redacted. */
  previewExport(context: {
    appVersion: string
    platform: string
    arch: string
    cliVersion?: string
  }) {
    this.prune()
    return JSON.stringify(
      {
        generatedAt: new Date(this.now()).toISOString(),
        app: context.appVersion,
        platform: `${context.platform} ${context.arch}`,
        cli: context.cliVersion ?? 'unknown',
        events: this.events.map((event) => ({
          ...event,
          name: redact(event.name),
          ...(event.detail ? { detail: redact(event.detail) } : {}),
        })),
      },
      null,
      2,
    )
  }
}
