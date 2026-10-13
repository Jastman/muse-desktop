import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { preferencesSchema, type Preferences } from '../shared/protocol'

export async function readPreferences(path: string): Promise<Preferences> {
  try {
    return preferencesSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return preferencesSchema.parse({})
    }
    throw new Error('Muse Desktop could not read its preferences. Your CLI data is unaffected.', {
      cause: error,
    })
  }
}

export async function writePreferences(path: string, preferences: Preferences) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(`${path}.tmp`, JSON.stringify(preferences, null, 2), { mode: 0o600 })
  await rename(`${path}.tmp`, path)
}
