import { z } from 'zod'

export const itemSchema = z.object({
  itemId: z.string(),
  kind: z.string(),
  revision: z.number(),
  status: z.string(),
  turnId: z.string().nullish(),
  text: z.string().optional(),
  displayText: z.string().optional(),
  summary: z.array(z.string()).optional(),
  tool: z.string().optional(),
  args: z.string().optional(),
  visibleOutput: z.string().optional(),
  commandText: z.string().optional(),
  fallbackText: z.string().optional(),
  statusLine: z.string().optional(),
  failureReason: z.string().optional(),
  objective: z.string().optional(),
  agentPath: z.string().optional(),
  role: z.string().optional(),
  childSessionId: z.string().optional(),
  subagentId: z.string().optional(),
  reminderAgentId: z.string().optional(),
  blocking: z.boolean().optional(),
  durationMs: z.number().optional(),
  exitCode: z.number().optional(),
  exitSignal: z.number().optional(),
  failureKind: z.string().optional(),
  approvalId: z.string().optional(),
  recordedAt: z.string().optional(),
  truncated: z.boolean().optional(),
  retracted: z.boolean().optional(),
  label: z.string().optional(),
  finalSummary: z.string().optional(),
  outputRef: z.object({ id: z.string(), byteLen: z.number().optional() }).passthrough().optional(),
  patchSummary: z.object({ added: z.number(), removed: z.number(), files: z.number() }).optional(),
  result: z
    .object({ text: z.string().optional(), summary: z.string().optional() })
    .passthrough()
    .optional(),
})
export type TranscriptItem = z.infer<typeof itemSchema>

export const sessionSchema = z.object({
  sessionId: z.string(),
  workspaceRoot: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastActivityAt: z.string().optional(),
  status: z.string(),
  activeTurnId: z.string().nullable(),
  modelId: z.string().nullable(),
  name: z.string().optional(),
  title: z.string().optional(),
  firstUserPrompt: z.string().optional(),
  branch: z.string().optional(),
  turnCount: z.number(),
  kind: z.string().optional(),
  approvalMode: z.object({ mode: z.string() }).passthrough().optional(),
})
export type MuseSession = z.infer<typeof sessionSchema>

export const approvalSchema = z.object({
  approvalId: z.string(),
  sessionId: z.string(),
  toolName: z.string(),
  rawArgs: z.string(),
  currentRequirementId: z.object({ approvalId: z.string(), sourceIndex: z.number() }),
  subject: z.object({
    kind: z.string(),
    command: z.string().optional(),
    path: z.string().optional(),
    host: z.string().optional(),
    target: z.string().optional(),
  }),
  availableChoices: z.array(
    z.object({
      choiceId: z.string(),
      label: z.string(),
      decision: z.string(),
      scope: z.string(),
      rulePreview: z.string().optional(),
      acceptsFeedback: z.boolean().optional(),
    }),
  ),
})
export type Approval = z.infer<typeof approvalSchema>

export const questionSchema = z.object({
  userInputId: z.string(),
  sessionId: z.string(),
  questions: z.array(
    z.object({
      id: z.string(),
      header: z.string(),
      question: z.string(),
      options: z.array(z.object({ label: z.string(), description: z.string().optional() })),
      selection: z.object({
        mode: z.enum(['single', 'multiple']),
        minSelections: z.number().optional(),
        maxSelections: z.number().optional(),
      }),
    }),
  ),
})
export type UserQuestion = z.infer<typeof questionSchema>

export const modelSchema = z.object({
  modelId: z.string(),
  displayLabel: z.string(),
  providerId: z.string(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  contextLimit: z.number().nullable(),
  defaultReasoningEffort: z.string().optional(),
  reasoningEffortVariants: z
    .array(z.object({ tier: z.string(), description: z.string().optional() }))
    .optional(),
  /** Supported effort tiers, or 'unknown' when the provider does not report them (ADR 33400 D2). */
  variants: z.union([z.array(z.string()), z.literal('unknown')]).optional(),
})
export type MuseModel = z.infer<typeof modelSchema>
export const paneLimits = {
  sidebar: { min: 200, max: 480, default: 268 },
  inspector: { min: 300, max: 760, default: 400 },
} as const

export const effortSchema = z.enum([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
])
export type ReasoningEffort = z.infer<typeof effortSchema>

const preferenceFields = {
  theme: z.enum(['muse', 'daylight', 'moonlight', 'grove', 'plush', 'system']),
  backgroundIntensity: z.number().min(0).max(100),
  cliPath: z.string().max(4096),
  recentProjects: z.array(z.string()),
  trustedProjects: z.array(z.string()),
  archivedSessionIds: z.array(z.string()),
  pinnedSessionIds: z.array(z.string()),
  reasoningEffort: effortSchema,
  fontSize: z.enum(['compact', 'comfortable', 'large']),
  reduceMotion: z.boolean(),
  notifyOnCompletion: z.boolean(),
  sidebarWidth: z.number().int().min(paneLimits.sidebar.min).max(paneLimits.sidebar.max),
  inspectorWidth: z.number().int().min(paneLimits.inspector.min).max(paneLimits.inspector.max),
  windowControls: z.enum(['native', 'custom']),
  transcriptRendering: z.enum(['virtualized', 'full']),
  announceUpdates: z.boolean(),
  historyIndex: z.boolean(),
  diagnostics: z.boolean(),
}

export const PREFERENCES_SCHEMA_VERSION = 2
/** Defaults used before schema version 2; existing users keep their expressive look. */
export const legacyPreferenceDefaults = { theme: 'muse', backgroundIntensity: 70 } as const

export const preferencesSchema = z.object({
  schemaVersion: z.literal(PREFERENCES_SCHEMA_VERSION).default(PREFERENCES_SCHEMA_VERSION),
  theme: preferenceFields.theme.default('system'),
  backgroundIntensity: preferenceFields.backgroundIntensity.default(20),
  cliPath: preferenceFields.cliPath.default(''),
  recentProjects: preferenceFields.recentProjects.default([]),
  trustedProjects: preferenceFields.trustedProjects.default([]),
  archivedSessionIds: preferenceFields.archivedSessionIds.default([]),
  pinnedSessionIds: preferenceFields.pinnedSessionIds.default([]),
  reasoningEffort: preferenceFields.reasoningEffort.default('high'),
  fontSize: preferenceFields.fontSize.default('comfortable'),
  reduceMotion: preferenceFields.reduceMotion.default(false),
  notifyOnCompletion: preferenceFields.notifyOnCompletion.default(false),
  sidebarWidth: preferenceFields.sidebarWidth.default(paneLimits.sidebar.default),
  inspectorWidth: preferenceFields.inspectorWidth.default(paneLimits.inspector.default),
  windowControls: preferenceFields.windowControls.default('native'),
  transcriptRendering: preferenceFields.transcriptRendering.default('virtualized'),
  announceUpdates: preferenceFields.announceUpdates.default(true),
  historyIndex: preferenceFields.historyIndex.default(true),
  diagnostics: preferenceFields.diagnostics.default(false),
})
// Updates must never apply defaults to omitted fields or grant project trust.
export const preferencesPatchSchema = z
  .object(preferenceFields)
  .omit({ trustedProjects: true, recentProjects: true })
  .partial()
  .strict()
export type Preferences = z.infer<typeof preferencesSchema>
export type Theme = Exclude<Preferences['theme'], 'system'>
export type PreferencesRecovery = {
  kind: 'malformed' | 'invalid-fields' | 'unreadable' | 'newer-version'
  message: string
  backupPath?: string
  invalidFields?: string[]
  canRestoreBackup: boolean
}
export type PreferencesRecoveryAction = 'retry' | 'reset' | 'restore-backup' | 'keep-recovered'

export type SessionView = {
  session: MuseSession
  items: TranscriptItem[]
  approvals: Approval[]
  questions: UserQuestion[]
  usage?: { input: number; output: number; total: number }
  error?: string
  historyNotice?: string
  /** turn/cancel was admitted; the turn is still running until turn/completed arrives. */
  cancelRequested?: boolean
  /** Follow-ups the CLI accepted with disposition `queued` and has not started yet. */
  queuedTurns?: { turnId: string; displayText: string }[]
  /** The CLI scheduled a model retry (turn/retryScheduled); cleared by later progress or completion. */
  retry?: {
    nextAttempt: number
    maxAttempts: number
    retryDelayMs: number
    reason: string
    receivedAt: number
  }
  /** Terminal state reported by the most recent turn/completed. */
  lastTurn?: { turnId?: string; terminal: string; durationMs?: number }
}
export type SendResult =
  | { status: 'accepted'; disposition: string; turnId?: string }
  | { status: 'rejected'; message: string }
  | { status: 'uncertain'; message: string }
export type ConnectionStatus = {
  state: 'connecting' | 'ready' | 'missing' | 'error'
  path?: string
  version?: string
  message?: string
  fingerprintWarning?: string
  epoch?: number
}
export type UpdateStatus = {
  available: boolean
  canCheck: boolean
  automaticChecks: boolean
  message?: string
}
export type GitChange = { path: string; status: string; staged: boolean }
export type GitStatus = { branch: string; changes: GitChange[]; isRepository: boolean }
export type Attachment = { id: string; name: string; kind: 'image' | 'text'; size: number }
export const attachmentLimits = {
  count: 5,
  fileBytes: 2 * 1024 * 1024,
  textBytes: 200 * 1024,
  messageBytes: 4 * 1024 * 1024,
} as const
export type AttachmentInput = { name: string; data: Uint8Array }
export const draftKeySchema = z
  .string()
  .max(4200)
  .regex(/^(session:[\w.:-]{1,200}|new:[^\0]{0,4096})$/)
export const storedDraftSchema = z.object({
  key: draftKeySchema,
  text: z.string().max(200000),
  updatedAt: z.string(),
  mode: z.enum(['queue', 'steer']).optional(),
  /** Metadata only. Attachment bytes and staged IDs never persist; restored files must be reattached. */
  attachments: z
    .array(
      z.object({
        name: z.string().max(200),
        kind: z.enum(['image', 'text']),
        size: z.number().int().nonnegative(),
      }),
    )
    .max(5),
  /** Set just before a send. Seen after restart, the outcome is unknown and must not be retried automatically. */
  sendState: z.enum(['sending']).optional(),
})
export type StoredDraft = z.infer<typeof storedDraftSchema>
export type DraftInput = Omit<StoredDraft, 'key' | 'updatedAt'>
export type ProjectFile = { name: string; path: string; directory: boolean }
export type AppEvent =
  | { type: 'connection'; status: ConnectionStatus }
  | { type: 'session'; view: SessionView }
  | { type: 'sessions-changed' }
  | { type: 'preferences'; preferences: Preferences; recovery?: PreferencesRecovery }
  | {
      type: 'menu'
      action: 'new' | 'open' | 'search' | 'settings' | 'sidebar' | 'find' | 'search-history'
    }
  | { type: 'error'; message: string }
  | { type: 'search-index'; status: SearchIndexStatus }

export type { SearchHit, SearchResult, IndexCoverage } from '../main/search-index'
import type { IndexCoverage, SearchResult } from '../main/search-index'
export type SearchIndexStatus = {
  enabled: boolean
  coverage: IndexCoverage
  /** Listing or persistence problem from the last build, shown verbatim. */
  lastError: string | null
  /** False when the last build could not list every CLI conversation. */
  listingComplete: boolean
}
const isoDate = z
  .string()
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date')
export const historySearchSchema = z
  .object({
    text: z.string().max(500),
    project: z.string().max(4096).nullable().optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    includeArchived: z.boolean(),
    offset: z.number().int().min(0).max(1_000_000),
    limit: z.number().int().min(1).max(100),
  })
  .strict()
export type HistorySearch = z.infer<typeof historySearchSchema>

export const answerSchema = z.object({
  questionId: z.string(),
  selectedLabel: z.string().optional(),
  selectedLabels: z.array(z.string()).optional(),
  freeText: z.string().max(500).optional(),
})
export type QuestionAnswer = z.infer<typeof answerSchema>

export interface DesktopAPI {
  updateStatus(): Promise<UpdateStatus>
  checkForUpdates(): Promise<UpdateStatus>
  setAutomaticUpdateChecks(enabled: boolean): Promise<UpdateStatus>
  bootstrap(): Promise<{
    preferencesRecovery?: PreferencesRecovery
    preferences: Preferences
    status: ConnectionStatus
    version: string
    home: string
    platform: string
  }>
  connect(): Promise<ConnectionStatus>
  chooseCli(): Promise<string | null>
  chooseProject(): Promise<string | null>
  savePreferences(patch: Partial<Preferences>): Promise<Preferences>
  recoverPreferences(
    action: PreferencesRecoveryAction,
  ): Promise<{ preferences: Preferences; recovery?: PreferencesRecovery }>
  listDrafts(): Promise<{ drafts: StoredDraft[]; notice?: string }>
  saveDraft(key: string, draft: DraftInput | null, immediate?: boolean): Promise<void>
  clearDrafts(keys?: string[]): Promise<void>
  searchHistory(query: HistorySearch): Promise<SearchResult>
  searchIndexStatus(): Promise<SearchIndexStatus>
  rebuildSearchIndex(): Promise<SearchIndexStatus>
  clearSearchIndex(): Promise<SearchIndexStatus>
  listSessions(cursor?: string): Promise<{ sessions: MuseSession[]; nextCursor: string | null }>
  createSession(project: string, modelId?: string): Promise<SessionView>
  openSession(sessionId: string, refresh?: boolean): Promise<SessionView>
  send(input: {
    sessionId: string
    text: string
    attachments: string[]
    attachmentScope: string
    effort: ReasoningEffort
    mode: 'queue' | 'steer'
  }): Promise<SendResult>
  cancel(sessionId: string): Promise<void>
  compact(sessionId: string): Promise<{ status: string }>
  renameSession(sessionId: string, name: string): Promise<void>
  models(sessionId?: string): Promise<MuseModel[]>
  setModel(sessionId: string, modelId: string): Promise<void>
  approve(sessionId: string, approvalId: string, choiceId: string): Promise<void>
  answer(sessionId: string, userInputId: string, answers: QuestionAnswer[]): Promise<void>
  cancelQuestion(sessionId: string, userInputId: string): Promise<void>
  chooseAttachments(scope: string): Promise<Attachment[]>
  stageAttachments(scope: string, files: AttachmentInput[]): Promise<Attachment[]>
  removeAttachment(id: string): Promise<void>
  requestMicrophone(): Promise<void>
  transcribeVoice(audio: Uint8Array): Promise<string>
  cancelVoice(): Promise<void>
  gitStatus(project: string): Promise<GitStatus>
  gitDiff(project: string, path: string): Promise<string>
  listFiles(project: string, directory: string): Promise<ProjectFile[]>
  readFile(project: string, path: string): Promise<string>
  revealProject(project: string): Promise<void>
  openTerminal(project: string, login?: boolean): Promise<void>
  openCli(project: string): Promise<void>
  exportSession(sessionId: string): Promise<string | null>
  readOutput(sessionId: string, itemId: string): Promise<string>
  openExternal(url: string): Promise<void>
  windowAction(action: 'minimize' | 'maximize' | 'close'): Promise<void>
  onEvent(callback: (event: AppEvent) => void): () => void
}
