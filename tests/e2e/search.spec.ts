import { expect, test } from '@playwright/test'
import { closeQuietly, composer, createSandbox } from './harness'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('history search finds message text in another conversation and jumps to it', async () => {
  const sandbox = await createSandbox()
  const { app, page } = await sandbox.launch()
  try {
    await composer(page).fill('Remember the zebra-token <tag>value</tag> please')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.locator('.agent-message')).toContainText('Echo:')

    await page.getByRole('button', { name: 'New conversation' }).first().click()
    await composer(page).fill('An unrelated second conversation')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.locator('.user-message-text')).toHaveText('An unrelated second conversation')

    await page.keyboard.press(`${mod}+Shift+F`)
    const dialog = page.getByRole('dialog', { name: 'Search message history' })
    const input = dialog.getByRole('combobox', { name: 'Search message history' })
    await input.fill('zebra-token')
    const hit = dialog
      .getByRole('listbox', { name: 'Matching messages' })
      .getByRole('option')
      .first()
    // Indexing is debounced and runs in the background; results appear once it catches up.
    await expect(hit).toContainText('zebra-token', { timeout: 30_000 })
    await expect(hit.locator('mark').first()).toHaveText('zebra-token')
    await expect(dialog.getByRole('status').first()).toContainText('conversations indexed')
    await input.press('Enter')

    await expect(dialog).toBeHidden()
    const target = page.locator('.user-message', { hasText: 'zebra-token' })
    await expect(target).toBeVisible()
    await expect(target).toBeFocused()
    await expect(page.locator('.user-message-text').first()).toHaveText(
      'Remember the zebra-token <tag>value</tag> please',
    )
    // Search is local: no model turn is started for it.
    expect((await sandbox.methods()).filter((method) => method === 'turn/start')).toHaveLength(2)
  } finally {
    await closeQuietly(app)
    await sandbox.dispose()
  }
})

test('archived conversations are excluded from history search unless requested', async () => {
  const sandbox = await createSandbox()
  const { app, page } = await sandbox.launch()
  try {
    await composer(page).fill('archived walrus-token message')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.locator('.agent-message')).toContainText('Echo:')
    await page.locator('summary[aria-label="Conversation actions"]').click()
    await page.getByRole('button', { name: /^Archive/ }).click()

    await page.keyboard.press(`${mod}+Shift+F`)
    const dialog = page.getByRole('dialog', { name: 'Search message history' })
    await dialog.getByRole('combobox', { name: 'Search message history' }).fill('walrus-token')
    await expect(dialog.getByText(/conversations indexed/)).toContainText(/^1 of 1/, {
      timeout: 30_000,
    })
    await expect(dialog.getByText('No indexed messages match.')).toBeVisible()
    await dialog.getByLabel('Include archived conversations').check()
    await expect(
      dialog.getByRole('listbox', { name: 'Matching messages' }).getByRole('option').first(),
    ).toContainText('Archived')
  } finally {
    await closeQuietly(app)
    await sandbox.dispose()
  }
})

test('find in conversation counts, steps through matches and restores focus', async () => {
  const sandbox = await createSandbox()
  const { app, page } = await sandbox.launch()
  try {
    await composer(page).fill('kiwi one')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.locator('.agent-message').last()).toContainText('Echo:')
    await composer(page).fill('kiwi two and KIWI three')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.locator('.agent-message')).toHaveCount(2)

    await composer(page).focus()
    await page.keyboard.press(`${mod}+F`)
    const find = page.getByRole('search', { name: 'Find in conversation' })
    const input = find.getByRole('textbox', { name: 'Find in conversation' })
    await expect(input).toBeFocused()
    await input.fill('kiwi')
    // Each echo repeats the prompt, so every user message is matched twice in the transcript.
    const count = find.locator('#find-count')
    await expect(count).toHaveText(/^1 of \d+$/)
    const total = Number((await count.textContent())!.split(' of ')[1])
    expect(total).toBeGreaterThanOrEqual(3)
    await input.press('Enter')
    await expect(count).toHaveText(`2 of ${total}`)
    await input.press('Shift+Enter')
    await input.press('Shift+Enter')
    await expect(count).toHaveText(`${total} of ${total}`)
    await input.fill('no-such-text')
    await expect(count).toHaveText('No results')
    await input.press('Escape')
    await expect(find).toBeHidden()
    await expect(composer(page)).toBeFocused()
  } finally {
    await closeQuietly(app)
    await sandbox.dispose()
  }
})

test('command menu offers message search separately from commands and titles', async () => {
  const sandbox = await createSandbox()
  const { app, page } = await sandbox.launch()
  try {
    await composer(page).click()
    await page.keyboard.press(`${mod}+K`)
    const menu = page.getByRole('dialog', { name: 'Search' })
    const input = menu.getByRole('combobox', { name: 'Search commands and conversations' })
    await input.fill('settings')
    await expect(menu.getByRole('option').first()).toHaveText(/Search messages for “settings”/)
    await expect(menu.getByRole('option', { name: /Open settings/ })).toBeVisible()
    await expect(input).toHaveAttribute('aria-activedescendant', 'cmd-item-search-history')
    await input.press('Enter')
    const history = page.getByRole('dialog', { name: 'Search message history' })
    await expect(history.getByRole('combobox', { name: 'Search message history' })).toHaveValue(
      'settings',
    )
  } finally {
    await closeQuietly(app)
    await sandbox.dispose()
  }
})
