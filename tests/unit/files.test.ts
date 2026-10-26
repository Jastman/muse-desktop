import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { listProjectFiles, readProjectFile } from '../../src/main/files'
import { parseGitStatus } from '../../src/main/git'
import { loadPreferences, writePreferences } from '../../src/main/preferences'
import { projectName } from '../../src/renderer/src/components/Primitives'
import { preferencesPatchSchema, preferencesSchema } from '../../src/shared/protocol'

let temporary: string
beforeEach(async () => {
  temporary = await realpath(await mkdtemp(join(tmpdir(), 'muse-unit-')))
})
afterEach(async () => {
  await rm(temporary, { recursive: true, force: true })
})

describe('project filesystem boundary', () => {
  it('reads local text and rejects traversal and escaping symlinks', async () => {
    const root = join(temporary, 'project')
    await mkdir(root)
    await writeFile(join(root, 'hello.ts'), 'export const hello = true')
    await writeFile(join(temporary, 'outside.txt'), 'private')
    await symlink(join(temporary, 'outside.txt'), join(root, 'link'))
    expect(await readProjectFile(root, 'hello.ts')).toContain('hello')
    await expect(readProjectFile(root, '../outside.txt')).rejects.toThrow('outside')
    await expect(readProjectFile(root, 'link')).rejects.toThrow('outside')
    expect((await listProjectFiles(root, '')).map((file) => file.name)).toEqual(['hello.ts'])
  })
  it('rejects binary and oversized text previews', async () => {
    await writeFile(join(temporary, 'binary'), Buffer.from([1, 0, 2]))
    await writeFile(join(temporary, 'large'), 'x'.repeat(512 * 1024 + 1))
    await expect(readProjectFile(temporary, 'binary')).rejects.toThrow('binary')
    await expect(readProjectFile(temporary, 'large')).rejects.toThrow('512 KB')
  })
  it('normalizes nested project file paths and extracts project names across platforms', async () => {
    const nested = join(temporary, 'nested')
    await mkdir(nested)
    await writeFile(join(nested, 'index.ts'), 'export {}')
    expect(await listProjectFiles(temporary, 'nested')).toEqual([
      { name: 'index.ts', path: 'nested/index.ts', directory: false },
    ])
    expect(projectName('/Users/alice/muse-desktop')).toBe('muse-desktop')
    expect(projectName('/home/alice/muse-desktop/')).toBe('muse-desktop')
    expect(projectName('C:\\Users\\alice\\muse-desktop')).toBe('muse-desktop')
    expect(projectName('D:\\projects\\muse-desktop\\')).toBe('muse-desktop')
  })
})

describe('Git status parsing', () => {
  it('preserves spaces, newlines, deleted names and renamed destinations', () => {
    const changes = parseGitStatus(
      ' M space name.ts\0R  new name.ts\0old name.ts\0?? line\nbreak.ts\0 D removed.ts\0',
    )
    expect(changes).toEqual([
      { path: 'space name.ts', status: 'M', staged: false },
      { path: 'new name.ts', status: 'R', staged: true },
      { path: 'line\nbreak.ts', status: '??', staged: false },
      { path: 'removed.ts', status: 'D', staged: false },
    ])
  })
})

describe('local preferences', () => {
  it('changes only supplied settings and rejects renderer project trust changes', () => {
    const current = preferencesSchema.parse({
      theme: 'plush',
      backgroundIntensity: 25,
      cliPath: '/custom/muse',
      pinnedSessionIds: ['pinned'],
      archivedSessionIds: ['archived'],
      fontSize: 'large',
      reduceMotion: true,
    })
    for (const [key, value] of Object.entries(current)) {
      if (['trustedProjects', 'recentProjects', 'schemaVersion'].includes(key)) continue
      expect(preferencesPatchSchema.parse({ [key]: value })).toEqual({ [key]: value })
    }
    const patch = preferencesPatchSchema.parse({ reasoningEffort: 'low' })
    expect(preferencesSchema.parse({ ...current, ...patch })).toEqual({
      ...current,
      reasoningEffort: 'low',
    })
    expect(preferencesPatchSchema.parse({})).toEqual({})
    expect(() => preferencesPatchSchema.parse({ trustedProjects: ['/tmp'] })).toThrow()
    expect(() => preferencesPatchSchema.parse({ recentProjects: ['/tmp'] })).toThrow()
  })
  it('defaults new installs to the quiet system theme and atomically saves settings', async () => {
    const path = join(temporary, 'desktop/preferences.json')
    expect((await loadPreferences(path)).preferences.theme).toBe('system')
    const preferences = preferencesSchema.parse({ theme: 'grove', backgroundIntensity: 35 })
    await writePreferences(path, preferences)
    expect((await loadPreferences(path)).preferences).toEqual(preferences)
    expect(JSON.parse(await readFile(path, 'utf8')).theme).toBe('grove')
  })
  it('reports malformed preferences instead of overwriting them', async () => {
    const path = join(temporary, 'preferences.json')
    await writeFile(path, '{broken')
    const state = await loadPreferences(path)
    expect(state.recovery?.kind).toBe('malformed')
    expect(state.writable).toBe(false)
    expect(await readFile(path, 'utf8')).toBe('{broken')
  })
})
