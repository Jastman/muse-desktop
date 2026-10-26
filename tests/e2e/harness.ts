import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Launches the built app against the deterministic fake Muse CLI in an isolated sandbox.
 * This is a protocol-level test double, not a real Muse Code integration test.
 */
export async function createSandbox(preferences: Record<string, unknown> = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'muse-desktop-e2e-')))
  const userData = join(root, 'desktop')
  const project = join(root, 'project')
  const museHome = join(root, 'muse')
  await mkdir(userData, { recursive: true })
  await mkdir(project, { recursive: true })
  await mkdir(museHome, { recursive: true })
  const cli = resolve(
    'tests/fixtures/fake-muse',
    process.platform === 'win32' ? 'muse.cmd' : 'muse',
  )
  if (process.platform !== 'win32') await chmod(cli, 0o755)
  const log = join(root, 'fake-muse.log')
  await writeFile(
    join(userData, 'preferences.json'),
    JSON.stringify({
      schemaVersion: 2,
      cliPath: cli,
      recentProjects: [project],
      trustedProjects: [project],
      ...preferences,
    }),
  )
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HOME: root,
    USERPROFILE: root,
    MUSE_HOME: museHome,
    MUSE_DESKTOP_USER_DATA: userData,
    XDG_CONFIG_HOME: join(root, 'config'),
    XDG_DATA_HOME: join(root, 'data'),
    XDG_STATE_HOME: join(root, 'state'),
    FAKE_MUSE_NODE: process.execPath,
    FAKE_MUSE_LOG: log,
    FAKE_MUSE_STREAM_DELAY_MS: '5',
  }
  return {
    root,
    userData,
    project,
    env,
    log,
    /** Methods the fake CLI received, in order (used to prove sends are never replayed). */
    async methods() {
      try {
        return (await readFile(log, 'utf8')).split('\n').filter(Boolean)
      } catch {
        return []
      }
    },
    async launch(extraEnv: Record<string, string> = {}) {
      const app = await electron.launch({
        args: [resolve('out/main/index.js')],
        env: { ...env, ...extraEnv },
      })
      const page = await app.firstWindow()
      return { app, page }
    },
    async dispose() {
      await rm(root, { recursive: true, force: true, maxRetries: 5 })
    },
  }
}

export function composer(page: Page) {
  return page.getByRole('textbox', { name: 'Message Muse' })
}

export async function closeQuietly(app: ElectronApplication | undefined) {
  if (!app) return
  await app.close().catch(() => undefined)
}
