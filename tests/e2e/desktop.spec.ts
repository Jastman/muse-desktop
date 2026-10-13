import {
  _electron as electron,
  test,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { discoverCli } from '../../src/main/cli'
import { MuseHost } from '../../src/main/muse-host'
import { preferencesSchema } from '../../src/shared/protocol'

let desktop: ElectronApplication
let page: Page
let sandbox: string
let project: string
const errors: string[] = []
test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  sandbox = await realpath(await mkdtemp(join(tmpdir(), 'muse-desktop-e2e-')))
  project = join(sandbox, 'little-ideas')
  const userData = join(sandbox, 'desktop')
  await mkdir(project, { recursive: true })
  await mkdir(userData, { recursive: true })
  await writeFile(join(project, 'hello.ts'), 'export const greeting = "A little possibility."\n')
  const binary = (await discoverCli(process.env.MUSE_BIN || '')).path
  const isolated = {
    ...process.env,
    HOME: sandbox,
    XDG_CONFIG_HOME: join(sandbox, 'config'),
    XDG_DATA_HOME: join(sandbox, 'data'),
    XDG_STATE_HOME: join(sandbox, 'state'),
    MUSE_HOME: join(sandbox, 'muse'),
    MUSE_DESKTOP_USER_DATA: userData,
    MUSE_DESKTOP_TEST_PROVIDER: 'echo',
  }
  const original = process.env
  process.env = isolated
  const host = new MuseHost(() => {})
  try {
    expect((await host.connect(binary)).state).toBe('ready')
    const prior = await host.create(project)
    await host.send(
      prior.session.sessionId,
      [{ type: 'text', text: 'A conversation started in the CLI.' }],
      'high',
      'queue',
      'A conversation started in the CLI.',
    )
    await expect
      .poll(() =>
        host
          .getView(prior.session.sessionId)
          .items.some((item) => item.kind === 'agentMessage' && item.status === 'completed'),
      )
      .toBe(true)
    await host.rename(prior.session.sessionId, 'previous cli conversation')
  } finally {
    await host.close()
    process.env = original
  }
  await writeFile(
    join(userData, 'preferences.json'),
    JSON.stringify(
      preferencesSchema.parse({
        trustedProjects: [project],
        cliPath: binary,
      }),
    ),
  )
  desktop = await electron.launch({
    args: [
      resolve('out/main/index.js'),
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
    env: isolated,
  })
  page = await desktop.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(page.getByText('Connected to Muse Code', { exact: true })).toBeVisible()
})

test.afterAll(async () => {
  await desktop?.close()
  if (sandbox) await rm(sandbox, { recursive: true, force: true })
})

test('renders the blue Muse workspace and all four illustrated themes', async () => {
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'muse')
  await expect(page.getByAltText('Muse mascot waving hello')).toBeVisible()
  await expect(page.locator('.chat-brand-background')).toBeVisible()
  await page.screenshot({ animations: 'disabled', path: 'docs/screenshots/muse.png' })
  for (const theme of ['Daylight', 'Moonlight', 'Grove', 'Plush', 'Muse']) {
    await page.getByRole('button', { name: `${theme} theme`, exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase())
    await page.screenshot({
      animations: 'disabled',
      path: `docs/screenshots/${theme.toLowerCase()}.png`,
    })
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('slider', { name: 'Background intensity' }).fill('40')
  await page.screenshot({ animations: 'disabled', path: 'docs/screenshots/appearance.png' })
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('discovers pre-existing CLI history and projects on a fresh desktop setup', async () => {
  await page
    .getByRole('button', { name: /previous cli conversation/ })
    .first()
    .click()
  await expect(page.locator('.agent-message .markdown')).toContainText(
    'A conversation started in the CLI.',
  )
  await expect(page.getByRole('combobox', { name: 'Current project' })).toContainText(
    'little-ideas',
  )
  await page.getByRole('button', { name: 'New conversation', exact: true }).click()
})

test('theme menus support keyboard selection, escape, outside clicks and saved preferences', async () => {
  const effort = page.getByRole('combobox', { name: 'Reasoning effort' })
  await effort.click()
  await expect(page.getByRole('listbox', { name: 'Reasoning effort' })).toBeVisible()
  await effort.press('Home')
  await effort.press('ArrowDown')
  await effort.press('ArrowDown')
  await effort.press('Enter')
  await expect(effort).toContainText('Low')
  expect((await page.evaluate(() => window.muse.bootstrap())).preferences.reasoningEffort).toBe(
    'low',
  )
  await effort.click()
  await effort.press('Escape')
  await expect(effort).toHaveAttribute('aria-expanded', 'false')
  await effort.click()
  await page.getByRole('textbox', { name: 'Message Muse' }).click()
  await expect(effort).toHaveAttribute('aria-expanded', 'false')
  await effort.click()
  await page.screenshot({ animations: 'disabled', path: 'docs/screenshots/effort-menu.png' })
  await effort.press('Escape')
})

test('thinking level and every preference stay independent across themes and reloads', async () => {
  const original = (await page.evaluate(() => window.muse.bootstrap())).preferences
  await page.evaluate(() =>
    window.muse.savePreferences({
      backgroundIntensity: 25,
      fontSize: 'large',
      reduceMotion: true,
      notifyOnCompletion: true,
      pinnedSessionIds: ['regression-pin'],
      archivedSessionIds: ['regression-archive'],
    }),
  )
  const effort = page.getByRole('combobox', { name: 'Reasoning effort' })
  for (const theme of ['Plush', 'Grove', 'Moonlight', 'Daylight', 'Muse']) {
    await page.getByRole('button', { name: `${theme} theme`, exact: true }).click()
    for (const label of ['Low', 'Medium', 'High', 'Extra high']) {
      await effort.click()
      await page.getByRole('option', { name: label, exact: true }).click()
      await expect(effort).toContainText(label)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase())
      const { preferences } = await page.evaluate(() => window.muse.bootstrap())
      expect(preferences).toEqual({
        ...original,
        theme: theme.toLowerCase(),
        reasoningEffort: label === 'Extra high' ? 'xhigh' : label.toLowerCase(),
        backgroundIntensity: 25,
        fontSize: 'large',
        reduceMotion: true,
        notifyOnCompletion: true,
        pinnedSessionIds: ['regression-pin'],
        archivedSessionIds: ['regression-archive'],
      })
    }
  }
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-text-size', 'large')
  await expect(effort).toContainText('Extra high')
  await page.evaluate(
    ({ recentProjects: _recent, trustedProjects: _trusted, ...patch }) =>
      window.muse.savePreferences(patch),
    original,
  )
})

test('conversations have usable scroll space and never sit behind the mascot or footer', async () => {
  for (const height of [880, 780, 740, 680, 600]) {
    await desktop.evaluate(({ BrowserWindow }, height) => {
      BrowserWindow.getAllWindows()[0].setSize(1100, height)
    }, height)
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const list = document.querySelector('.conversation-list')!.getBoundingClientRect()
          const footer = document.querySelector('.sidebar-bottom')!.getBoundingClientRect()
          const mascot = document.querySelector('.sidebar-companion')!.getBoundingClientRect()
          return (
            list.height >= 100 &&
            list.bottom <= footer.top &&
            (mascot.height === 0 || list.bottom <= mascot.top) &&
            footer.bottom <= innerHeight
          )
        }),
      )
      .toBe(true)
    const conversation = page.getByRole('button', { name: /previous cli conversation/ }).first()
    await conversation.scrollIntoViewIfNeeded()
    await conversation.click()
    await expect(page.locator('.agent-message .markdown')).toContainText(
      'A conversation started in the CLI.',
    )
  }
  await page.screenshot({ animations: 'disabled', path: 'docs/screenshots/compact.png' })
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1340, 880))
  await page.getByRole('button', { name: 'New conversation', exact: true }).click()
})

test('voice records a clip, inserts a reviewed draft, and cancels without sending', async () => {
  // Simulated input avoids recording the developer's microphone or requesting OS access.
  // The real authenticated transcription command is verified separately with synthetic speech.
  await desktop.evaluate(({ systemPreferences, ipcMain }) => {
    systemPreferences.askForMediaAccess = async () => true
    ipcMain.removeHandler('muse:voice')
    ipcMain.handle('muse:voice', (_event, audio: Uint8Array) => {
      const wav = Buffer.from(audio)
      if (
        wav.toString('ascii', 0, 4) !== 'RIFF' ||
        wav.readUInt32LE(24) !== 16000 ||
        wav.length < 6444
      )
        return { ok: false, error: 'Test captured an invalid voice clip.' }
      return { ok: true, value: 'A voice draft to review.' }
    })
  })
  const composer = page.getByRole('textbox', { name: 'Message Muse' })
  await composer.fill('Existing draft.')
  await page.keyboard.press('Alt+v')
  await expect(page.getByRole('button', { name: 'Stop recording (⌥V)', exact: true })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('0:01')
  await page.keyboard.press('Alt+v')
  await expect(composer).toHaveValue('Existing draft. A voice draft to review.')
  await expect(page.locator('.user-message-text')).toHaveCount(0)
  await page.getByRole('button', { name: 'Voice input (⌥V)', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop recording (⌥V)', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel voice input' }).click()
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect(composer).toHaveValue('Existing draft. A voice draft to review.')
  await composer.fill('')
})

test('real project files, docs and commands are accessible', async () => {
  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'little-ideas', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Files', exact: true }).click()
  await page.getByRole('button', { name: 'hello.ts', exact: true }).click()
  await expect(page.locator('.file-preview pre')).toContainText('A little possibility.')
  await page.getByRole('button', { name: 'Ask Muse', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Message Muse' })).toHaveValue(/hello.ts/)
  await page.getByRole('button', { name: 'Docs', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Getting started' })).toBeVisible()
  await page.getByRole('button', { name: 'Search conversations and commands' }).click()
  await page.getByRole('textbox', { name: 'Search commands and conversations' }).fill('moonlight')
  await page.getByRole('textbox', { name: 'Search commands and conversations' }).press('Enter')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'moonlight')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Chat', exact: true }).click()
})

test('sends a real echo turn, persists history and renames the session', async () => {
  const composer = page.getByRole('textbox', { name: 'Message Muse' })
  await composer.fill('Hello from the Muse Desktop integration test.')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect(page.locator('.user-message-text')).toContainText(
    'Hello from the Muse Desktop integration test.',
  )
  await expect(page.locator('.agent-message .markdown')).toContainText(
    'Hello from the Muse Desktop integration test.',
  )
  await expect(page.getByRole('button', { name: 'Stop Muse' })).toHaveCount(0)
  await expect(composer).toHaveValue('')
  await page.getByLabel('Conversation actions').click()
  await page.getByRole('button', { name: 'Rename conversation', exact: true }).click()
  await page.getByLabel('Conversation name').fill('A little desktop test')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('.breadcrumb-title')).toHaveText('a little desktop test')
  await page.getByRole('button', { name: 'Toggle project inspector' }).click()
  await expect(
    page.getByText('This folder isn’t a Git repository. Muse can still work with its files.'),
  ).toBeVisible()
  await page.screenshot({ animations: 'disabled', path: 'docs/screenshots/conversation.png' })
  await page.getByRole('button', { name: 'Close inspector' }).click()
  await page.getByRole('button', { name: 'New conversation', exact: true }).click()
  await page
    .getByRole('button', { name: /a little desktop test/i })
    .first()
    .click()
  await expect(page.locator('.agent-message .markdown')).toContainText(
    'Hello from the Muse Desktop integration test.',
  )
  expect(errors).toEqual([])
})

test('composer commands control the app without becoming model messages', async () => {
  const composer = page.getByRole('textbox', { name: 'Message Muse' })
  await composer.fill('/effort medium')
  await composer.press('Enter')
  await expect(page.getByRole('combobox', { name: 'Reasoning effort' })).toContainText('Medium')
  await expect(page.locator('.user-message-text')).toHaveCount(1)
  await composer.fill('/plugins')
  await composer.press('Enter')
  await expect(page.getByRole('alert')).toContainText('not handled by Desktop')
  await expect(page.locator('.user-message-text')).toHaveCount(1)
  await page.getByRole('button', { name: 'Dismiss notification' }).click()
  await composer.fill('/clear')
  await composer.press('Enter')
  await expect(page.locator('.user-message-text')).toHaveCount(0)
  await expect(composer).toHaveValue('')
  await expect(page.getByRole('button', { name: /a little desktop test/i }).first()).toBeVisible()
  await composer.fill('/vo')
  await expect(page.getByRole('option', { name: /voice/ })).toBeVisible()
  await composer.press('Tab')
  await expect(composer).toHaveValue('/voice ')
  await composer.press('Enter')
  await expect(page.getByRole('button', { name: 'Stop recording (⌥V)', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel voice input' }).click()
  await expect(composer).toHaveValue('')
})

test('rejects unsafe IPC paths and external link schemes', async () => {
  const result = await page.evaluate(
    async ({ project }) => {
      const rejected: string[] = []
      for (const [name, action] of [
        ['external', () => window.muse.openExternal('file:///etc/passwd')],
        ['traversal', () => window.muse.readFile(project, '../desktop/preferences.json')],
        ['unknown-project', () => window.muse.listFiles('/etc', '')],
      ] as const) {
        try {
          await action()
        } catch {
          rejected.push(name)
        }
      }
      return rejected
    },
    { project },
  )
  expect(result).toEqual(['external', 'traversal', 'unknown-project'])
})
