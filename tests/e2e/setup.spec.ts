import { _electron as electron, test, expect } from '@playwright/test'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { discoverCli } from '../../src/main/cli'

test('a missing installation has actionable setup and preserves preferences after restart', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'muse-desktop-setup-'))
  const userData = join(sandbox, 'desktop')
  await mkdir(userData)
  const preferencePath = join(userData, 'preferences.json')
  await writeFile(
    preferencePath,
    JSON.stringify({ cliPath: join(sandbox, 'not-installed'), theme: 'plush' }),
  )
  const options = {
    args: [resolve('out/main/index.js')],
    env: {
      ...process.env,
      HOME: sandbox,
      MUSE_HOME: join(sandbox, 'muse'),
      MUSE_DESKTOP_USER_DATA: userData,
      XDG_CONFIG_HOME: join(sandbox, 'config'),
      XDG_DATA_HOME: join(sandbox, 'data'),
      XDG_STATE_HOME: join(sandbox, 'state'),
    },
  }
  let app = await electron.launch(options)
  try {
    let page = await app.firstWindow()
    await expect(page.getByRole('button', { name: 'Set up', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled()
    await page.getByRole('button', { name: 'Set up', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Muse Code connection' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open installation guide' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save & reconnect' })).toBeVisible()
    await page.getByRole('button', { name: 'About', exact: true }).click()
    await expect(
      page.getByText('An unofficial, open-source companion for Muse Code by Robert Courson.'),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Check for updates', exact: true }),
    ).toBeDisabled()
    await expect(page.getByText(/Updates are available in the packaged Mac app/)).toBeVisible()
    await page.getByRole('button', { name: 'Close dialog' }).click()
    await page.getByRole('combobox', { name: 'Reasoning effort' }).click()
    await page.getByRole('option', { name: 'Medium', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'plush')
    await app.close()
    app = await electron.launch(options)
    page = await app.firstWindow()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'plush')
    await expect(page.getByRole('combobox', { name: 'Reasoning effort' })).toContainText('Medium')
    expect(JSON.parse(await readFile(preferencePath, 'utf8'))).toMatchObject({
      theme: 'plush',
      reasoningEffort: 'medium',
      cliPath: join(sandbox, 'not-installed'),
    })
  } finally {
    await app.close()
    await rm(sandbox, { recursive: true, force: true })
  }
})

test('renders Mac-style traffic lights and handles shortcuts on Windows and Linux', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'muse-desktop-win-'))
  const userData = join(sandbox, 'desktop')
  const project = join(sandbox, 'little-ideas')
  await mkdir(userData, { recursive: true })
  await mkdir(project, { recursive: true })
  const realProject = await realpath(project)
  const cliPath = await discoverCli(process.env.MUSE_BIN || '').then(
    (cli) => cli.path,
    () => join(sandbox, 'not-installed'),
  )
  for (const [platform, filename, fileManager, theme] of [
    ['win32', 'windows.png', 'Explorer', 'daylight'],
    ['linux', 'linux.png', 'Files', 'moonlight'],
  ] as const) {
    await writeFile(
      join(userData, 'preferences.json'),
      JSON.stringify({
        cliPath,
        theme,
        recentProjects: [realProject],
        trustedProjects: [realProject],
      }),
    )
    const app = await electron.launch({
      args: [resolve('out/main/index.js')],
      env: {
        ...process.env,
        HOME: sandbox,
        MUSE_HOME: join(sandbox, 'muse'),
        MUSE_DESKTOP_USER_DATA: userData,
        MUSE_DESKTOP_PLATFORM: platform,
        MUSE_DESKTOP_TEST_PROVIDER: 'echo',
      },
    })
    try {
      const page = await app.firstWindow()
      await expect(page.getByRole('group', { name: 'Window controls' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Close window' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Minimize window' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Maximize window' })).toBeVisible()
      await page.getByRole('button', { name: 'Toggle project inspector' }).click()
      await expect(
        page.locator('.inspector-footer').getByRole('button', { name: fileManager }),
      ).toBeVisible()
      await expect(
        page.getByText('This folder isn’t a Git repository. Muse can still work with its files.'),
      ).toBeVisible()
      if (!cliPath.endsWith('not-installed')) {
        await expect(page.getByText('Connected to Muse Code', { exact: true })).toBeVisible()
      }
      await page.screenshot({ animations: 'disabled', path: `docs/screenshots/${filename}` })
      await page.keyboard.press('Control+b')
      await expect(page.locator('.app-shell')).toHaveClass(/sidebar-hidden/)
      await page.keyboard.press('Control+b')
      await expect(page.locator('.app-shell')).not.toHaveClass(/sidebar-hidden/)
    } finally {
      await app.close()
    }
  }
  await rm(sandbox, { recursive: true, force: true })
})
