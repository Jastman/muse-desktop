import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { APP_VERSION } from '../../src/shared/version'

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'))

describe('version metadata', () => {
  it('uses package.json as the single source of truth', () => {
    const pkg = read('package.json')
    const lock = read('package-lock.json')
    expect(APP_VERSION).toBe(pkg.version)
    expect(lock.version).toBe(pkg.version)
    expect(lock.packages[''].version).toBe(pkg.version)
  })

  it('is a valid semver that does not reuse the released 0.2.0 version', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/)
    expect(APP_VERSION).not.toBe('0.2.0')
  })

  it('does not hard-code the version in application sources', () => {
    for (const file of ['src/main/muse-host.ts', 'src/renderer/src/App.tsx']) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/['"]0\.[0-9]+\.[0-9]+['"]/)
    }
  })
})
