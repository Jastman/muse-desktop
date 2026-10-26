import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  loadPreferences,
  migratePreferences,
  recoverPreferences,
  writePreferences,
} from '../../src/main/preferences'
import { PREFERENCES_SCHEMA_VERSION, preferencesSchema } from '../../src/shared/protocol'

let directory: string
let path: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'muse-preferences-'))
  path = join(directory, 'preferences.json')
})
afterEach(async () => {
  await chmod(path, 0o600).catch(() => {})
  await rm(directory, { recursive: true, force: true })
})

const files = async () => (await readdir(directory)).sort()

describe('preferences recovery', () => {
  it('uses quiet defaults for a missing file without writing anything', async () => {
    const state = await loadPreferences(path)
    expect(state).toEqual({ preferences: preferencesSchema.parse({}), writable: true })
    expect(state.preferences.theme).toBe('system')
    expect(state.preferences.windowControls).toBe('native')
    expect(await files()).toEqual([])
  })

  it('migrates version 1 files and keeps existing users on their expressive look', async () => {
    await writeFile(path, JSON.stringify({ cliPath: '/opt/muse', pinnedSessionIds: ['a'] }))
    const state = await loadPreferences(path)
    expect(state.writable).toBe(true)
    expect(state.recovery).toBeUndefined()
    expect(state.preferences).toMatchObject({
      schemaVersion: PREFERENCES_SCHEMA_VERSION,
      theme: 'muse',
      backgroundIntensity: 70,
      windowControls: 'custom',
      cliPath: '/opt/muse',
      pinnedSessionIds: ['a'],
    })
    expect((await files()).some((name) => name.startsWith('preferences.json.v1-'))).toBe(true)
    expect(migratePreferences({ theme: 'grove' })).toMatchObject({ theme: 'grove' })
  })

  it('keeps the malformed original, uses defaults and blocks writes until the user decides', async () => {
    await writeFile(path, '{"theme": "grove",')
    const state = await loadPreferences(path)
    expect(state.recovery).toMatchObject({ kind: 'malformed', canRestoreBackup: false })
    expect(state.writable).toBe(false)
    expect(state.preferences).toEqual(preferencesSchema.parse({}))
    expect(await readFile(path, 'utf8')).toBe('{"theme": "grove",')
    expect(await readFile(state.recovery!.backupPath!, 'utf8')).toBe('{"theme": "grove",')
    expect(state.recovery!.message).toContain('CLI')

    const reset = await recoverPreferences(path, state, 'reset')
    expect(reset).toEqual({ preferences: preferencesSchema.parse({}), writable: true })
    expect(JSON.parse(await readFile(path, 'utf8')).schemaVersion).toBe(PREFERENCES_SCHEMA_VERSION)
    expect(await readFile(state.recovery!.backupPath!, 'utf8')).toBe('{"theme": "grove",')
  })

  it('treats non-object JSON as malformed rather than crashing', async () => {
    await writeFile(path, '[1,2,3]')
    expect((await loadPreferences(path)).recovery?.kind).toBe('malformed')
  })

  it('salvages valid fields and reports invalid ones', async () => {
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 2,
        theme: 'grove',
        backgroundIntensity: 900,
        fontSize: 'gigantic',
        pinnedSessionIds: ['x'],
      }),
    )
    const state = await loadPreferences(path)
    expect(state.recovery).toMatchObject({
      kind: 'invalid-fields',
      invalidFields: ['backgroundIntensity', 'fontSize'],
    })
    expect(state.writable).toBe(false)
    expect(state.preferences).toMatchObject({
      theme: 'grove',
      backgroundIntensity: 20,
      fontSize: 'comfortable',
      pinnedSessionIds: ['x'],
    })
    const kept = await recoverPreferences(path, state, 'keep-recovered')
    expect(kept.writable).toBe(true)
    expect(JSON.parse(await readFile(path, 'utf8')).theme).toBe('grove')
  })

  it('never overwrites a file from a newer version', async () => {
    const newer = JSON.stringify({ schemaVersion: 99, theme: 'plush', futureField: true })
    await writeFile(path, newer)
    const state = await loadPreferences(path)
    expect(state.recovery?.kind).toBe('newer-version')
    expect(state.writable).toBe(false)
    expect(state.preferences.theme).toBe('plush')
    await expect(recoverPreferences(path, state, 'keep-recovered')).rejects.toThrow('newer')
    expect(await readFile(path, 'utf8')).toBe(newer)
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'does not overwrite an unreadable file',
    async () => {
      await writeFile(path, JSON.stringify({ theme: 'grove' }))
      await chmod(path, 0o000)
      const state = await loadPreferences(path)
      expect(state.recovery?.kind).toBe('unreadable')
      expect(state.writable).toBe(false)
      expect(state.recovery?.message).toContain('nothing will be written')
      await chmod(path, 0o600)
      const retried = await recoverPreferences(path, state, 'retry')
      expect(retried.writable).toBe(true)
      expect(retried.preferences.theme).toBe('grove')
    },
  )

  it('restores the last known good backup after a later corruption', async () => {
    await writePreferences(path, preferencesSchema.parse({ theme: 'grove' }))
    await writePreferences(path, preferencesSchema.parse({ theme: 'plush' }))
    await writeFile(path, 'garbage')
    const state = await loadPreferences(path)
    expect(state.recovery).toMatchObject({ kind: 'malformed', canRestoreBackup: true })
    const restored = await recoverPreferences(path, state, 'restore-backup')
    expect(restored.preferences.theme).toBe('grove')
    expect(restored.writable).toBe(true)
  })

  it('surfaces write failures without replacing the existing file', async () => {
    await writePreferences(path, preferencesSchema.parse({ theme: 'grove' }))
    const blocked = join(directory, 'blocked')
    await mkdir(join(blocked, 'preferences.json'), { recursive: true })
    await expect(
      writePreferences(join(blocked, 'preferences.json'), preferencesSchema.parse({})),
    ).rejects.toThrow()
    expect(JSON.parse(await readFile(path, 'utf8')).theme).toBe('grove')
  })
})
