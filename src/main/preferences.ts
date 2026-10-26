import { constants } from 'node:fs'
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  PREFERENCES_SCHEMA_VERSION,
  legacyPreferenceDefaults,
  preferencesSchema,
  type Preferences,
  type PreferencesRecovery,
  type PreferencesRecoveryAction,
} from '../shared/protocol'

export type PreferencesState = {
  preferences: Preferences
  /** False while the file on disk needs a user decision; changes then apply in memory only. */
  writable: boolean
  recovery?: PreferencesRecovery
}

const unaffected = 'Your Muse CLI conversations, credentials, and settings are unaffected.'
const fields = preferencesSchema.shape

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function codeOf(error: unknown) {
  return error instanceof Error && 'code' in error ? String(error.code) : undefined
}

async function backup(path: string, suffix: string) {
  const target = `${path}.${suffix}-${new Date().toISOString().replace(/[:.]/g, '-')}`
  await copyFile(path, target, constants.COPYFILE_EXCL)
  return target
}

/** Brings a known older document to the current version. Version 1 files had no schemaVersion. */
export function migratePreferences(raw: Record<string, unknown>): Record<string, unknown> {
  const version = raw.schemaVersion ?? 1
  if (version === 1) {
    // Version 1 defaulted to the expressive Muse theme; keep that look for existing users.
    return {
      ...raw,
      theme: raw.theme ?? legacyPreferenceDefaults.theme,
      backgroundIntensity: raw.backgroundIntensity ?? legacyPreferenceDefaults.backgroundIntensity,
      windowControls: raw.windowControls ?? 'custom',
      schemaVersion: PREFERENCES_SCHEMA_VERSION,
    }
  }
  return raw
}

/** Keeps every valid field and reports the invalid ones instead of discarding the whole file. */
export function salvagePreferences(raw: Record<string, unknown>) {
  const salvaged: Record<string, unknown> = {}
  const invalidFields: string[] = []
  for (const [key, schema] of Object.entries(fields)) {
    if (!(key in raw) || key === 'schemaVersion') continue
    const result = schema.safeParse(raw[key])
    if (result.success) salvaged[key] = result.data
    else invalidFields.push(key)
  }
  return { preferences: preferencesSchema.parse(salvaged), invalidFields }
}

async function validBackup(path: string) {
  try {
    const raw: unknown = JSON.parse(await readFile(`${path}.bak`, 'utf8'))
    if (!isRecord(raw)) return undefined
    const migrated = migratePreferences(raw)
    if (migrated.schemaVersion !== PREFERENCES_SCHEMA_VERSION) return undefined
    const result = preferencesSchema.safeParse(migrated)
    return result.success ? result.data : undefined
  } catch {
    return undefined
  }
}

export async function loadPreferences(path: string): Promise<PreferencesState> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (codeOf(error) === 'ENOENT')
      return { preferences: preferencesSchema.parse({}), writable: true }
    return {
      preferences: preferencesSchema.parse({}),
      writable: false,
      recovery: {
        kind: 'unreadable',
        message: `Muse Desktop could not open its preferences file (${codeOf(error) ?? 'unknown error'}). Defaults are in use and nothing will be written until you choose what to do. ${unaffected}`,
        canRestoreBackup: Boolean(await validBackup(path)),
      },
    }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    raw = undefined
  }
  if (!isRecord(raw)) {
    const backupPath = await backup(path, 'malformed').catch(() => undefined)
    return {
      preferences: preferencesSchema.parse({}),
      writable: false,
      recovery: {
        kind: 'malformed',
        message: `Muse Desktop’s preferences file is damaged, so defaults are in use. ${backupPath ? 'The original was copied before anything changed. ' : 'The original file has not been changed. '}${unaffected}`,
        backupPath,
        canRestoreBackup: Boolean(await validBackup(path)),
      },
    }
  }
  const version = raw.schemaVersion ?? 1
  if (typeof version !== 'number' || version > PREFERENCES_SCHEMA_VERSION) {
    const { preferences } = salvagePreferences(raw)
    return {
      preferences,
      writable: false,
      recovery: {
        kind: 'newer-version',
        message: `These preferences were saved by a newer Muse Desktop. Compatible settings are in use, but changes will not be saved so the newer version’s file is preserved. ${unaffected}`,
        canRestoreBackup: Boolean(await validBackup(path)),
      },
    }
  }
  const migrated = migratePreferences(raw)
  if (version !== PREFERENCES_SCHEMA_VERSION)
    await backup(path, `v${version}`).catch(() => undefined)
  const { preferences, invalidFields } = salvagePreferences(migrated)
  if (invalidFields.length) {
    const backupPath = await backup(path, 'invalid').catch(() => undefined)
    return {
      preferences,
      writable: false,
      recovery: {
        kind: 'invalid-fields',
        message: `Some preferences could not be read (${invalidFields.join(', ')}). Valid settings were kept and defaults replace the rest. ${unaffected}`,
        backupPath,
        invalidFields,
        canRestoreBackup: Boolean(await validBackup(path)),
      },
    }
  }
  return { preferences, writable: true }
}

/** Atomically replaces the file and keeps the previous valid file as a last-known-good backup. */
export async function writePreferences(path: string, preferences: Preferences, keepBackup = true) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(preferences, null, 2), { mode: 0o600 })
  if (keepBackup)
    await copyFile(path, `${path}.bak`).catch((error: unknown) => {
      if (codeOf(error) !== 'ENOENT') throw error
    })
  await rename(temporary, path)
}

/** Applies an explicit user choice from the recovery prompt. */
export async function recoverPreferences(
  path: string,
  state: PreferencesState,
  action: PreferencesRecoveryAction,
): Promise<PreferencesState> {
  if (action === 'retry') return loadPreferences(path)
  if (action === 'reset') {
    const preferences = preferencesSchema.parse({ cliPath: state.preferences.cliPath })
    await writePreferences(path, preferences, false)
    return { preferences, writable: true }
  }
  if (action === 'restore-backup') {
    const preferences = await validBackup(path)
    if (!preferences) throw new Error('There is no valid preferences backup to restore.')
    await writePreferences(path, preferences, false)
    return { preferences, writable: true }
  }
  if (state.recovery?.kind === 'newer-version')
    throw new Error('Keeping these settings would overwrite a newer version’s preferences.')
  await writePreferences(path, state.preferences, false)
  return { preferences: state.preferences, writable: true }
}
