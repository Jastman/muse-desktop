import { expect, test } from '@playwright/test'
import { closeQuietly, composer, createSandbox } from './harness'

test('sends through the fake CLI, shows markup faithfully and summarizes the finished turn', async () => {
  const sandbox = await createSandbox()
  const { app, page } = await sandbox.launch()
  try {
    const prompt = 'Explain <div class="x">hi</div> and <system>keep me</system>'
    await composer(page).fill(prompt)
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.locator('.user-message-text')).toHaveText(prompt)
    await expect(page.locator('.agent-message')).toContainText('Echo:')
    await expect(page.getByLabel('Muse activity')).toContainText('Finished')
    await expect(page.getByLabel('Muse activity')).toContainText('No commands were run')
    expect((await sandbox.methods()).filter((method) => method === 'turn/start')).toHaveLength(1)
  } finally {
    await closeQuietly(app)
    await sandbox.dispose()
  }
})

test('drafts survive restart and a rejected send restores the draft without replay', async () => {
  const sandbox = await createSandbox()
  let { app, page } = await sandbox.launch()
  try {
    await composer(page).fill('Draft that must survive <b>restart</b>')
    // Debounced save, then a clean quit flushes pending drafts.
    await page.waitForTimeout(700)
    await app.close()
    ;({ app, page } = await sandbox.launch())
    await expect(composer(page)).toHaveValue('Draft that must survive <b>restart</b>')

    await composer(page).fill('please [reject-send] this')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Not sent' })).toBeVisible()
    await expect(composer(page)).toHaveValue('please [reject-send] this')
    await expect(page.locator('.user-message-text')).toHaveCount(0)
    expect((await sandbox.methods()).filter((method) => method === 'turn/start')).toHaveLength(1)
  } finally {
    await closeQuietly(app)
    await sandbox.dispose()
  }
})

test('activity strip jumps to a pending approval and shows its scope before deciding', async () => {
  const sandbox = await createSandbox()
  const { app, page } = await sandbox.launch()
  try {
    await composer(page).fill('run checks [approval]')
    await page.getByRole('button', { name: 'Send message' }).click()
    const strip = page.getByLabel('Muse activity')
    await expect(strip).toContainText('Waiting for your approval')
    await expect(page.getByLabel('What each choice allows')).toContainText(
      'Allows matching requests for the rest of this conversation.',
    )
    await strip.getByRole('button', { name: 'Review request' }).click()
    await expect(page.getByRole('button', { name: 'Allow once' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('.agent-message').last()).toContainText('All 3 tests passed')
    await expect(strip).toContainText('Finished')
  } finally {
    await closeQuietly(app)
    await sandbox.dispose()
  }
})

test('a CLI crash mid-stream reconnects without replaying the send', async () => {
  const sandbox = await createSandbox()
  const { app, page } = await sandbox.launch()
  try {
    await composer(page).fill('stream then [crash]')
    await page.getByRole('button', { name: 'Send message' }).click()
    const strip = page.getByLabel('Muse activity')
    await expect(strip).toContainText('Connection interrupted')
    await page.locator('.connection-banner').getByRole('button', { name: 'Reconnect' }).click()
    // After recovery the strip either shows another state or is hidden while idle.
    await expect(page.getByText('Connection interrupted')).toHaveCount(0)
    // The reopened conversation comes from durable CLI history: the user message survives and the
    // partial reply that was never committed is gone. Nothing is resent.
    await expect(page.locator('.user-message-text')).toHaveText('stream then [crash]')
    await expect(page.locator('.agent-message')).toHaveCount(0)
    await composer(page).fill('after recovery')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.locator('.agent-message').last()).toContainText('Echo: after recovery')
    const starts = (await sandbox.methods()).filter((method) => method === 'turn/start')
    expect(starts).toHaveLength(2)
  } finally {
    await closeQuietly(app)
    await sandbox.dispose()
  }
})

test('stop shows a requested state until the CLI confirms the turn ended', async () => {
  const sandbox = await createSandbox()
  const { app, page } = await sandbox.launch({ FAKE_MUSE_CANCEL_DELAY_MS: '1500' })
  try {
    await composer(page).fill('long reply [slow]')
    await page.getByRole('button', { name: 'Send message' }).click()
    await page.getByRole('button', { name: 'Stop Muse' }).click()
    await expect(page.getByRole('button', { name: 'Stop requested' })).toBeDisabled()
    await expect(page.getByLabel('Muse activity')).toContainText('Stopping')
    await expect(page.getByLabel('Muse activity')).toContainText('Stopped', { timeout: 10000 })
  } finally {
    await closeQuietly(app)
    await sandbox.dispose()
  }
})

test('queued follow-ups are previewed until they start', async () => {
  const sandbox = await createSandbox()
  const { app, page } = await sandbox.launch()
  try {
    await composer(page).fill('first [slow]')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.getByRole('button', { name: 'Stop Muse' })).toBeVisible()
    await composer(page).fill('second, after the first')
    await page.getByRole('button', { name: 'Send follow-up' }).click()
    const strip = page.getByLabel('Muse activity')
    await expect(strip).toContainText('Follow-up queued')
    await expect(strip).toContainText('second, after the first')
    await page.getByRole('button', { name: 'Stop Muse' }).click()
    await expect(page.locator('.agent-message').last()).toContainText('Echo: second', {
      timeout: 15000,
    })
    await expect(strip).not.toContainText('Follow-up queued')
  } finally {
    await closeQuietly(app)
    await sandbox.dispose()
  }
})

test('dropped and pasted images reach the CLI as real bytes', async () => {
  const sandbox = await createSandbox()
  const { app, page } = await sandbox.launch()
  try {
    // A 1x1 PNG.
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    await expect(composer(page)).toBeEditable()
    await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const file = new File([bytes], 'pixel.png', { type: 'image/png' })
      const transfer = new DataTransfer()
      transfer.items.add(file)
      document
        .querySelector('form.composer')!
        .dispatchEvent(
          new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
        )
    }, png)
    const chip = page.getByLabel('Attached files')
    await expect(chip).toContainText('pixel.png')
    await expect(chip.locator('img.attachment-thumbnail')).toHaveCount(1)
    await composer(page).fill('What is in this image?')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.locator('.agent-message').last()).toContainText(
      `Received image image/png (${Buffer.from(png, 'base64').length} bytes)`,
    )
    await expect(page.getByLabel('Attached files')).toHaveCount(0)

    await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const transfer = new DataTransfer()
      transfer.items.add(new File([bytes], 'clip.png', { type: 'image/png' }))
      document
        .querySelector('textarea')!
        .dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
        )
    }, png)
    await expect(page.getByLabel('Attached files')).toContainText('clip.png')
    await composer(page).fill('And this pasted one?')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.locator('.agent-message').last()).toContainText('Received image image/png')
    await expect(page.locator('.agent-message').last()).toContainText('Echo: And this pasted one?')
  } finally {
    await closeQuietly(app)
    await sandbox.dispose()
  }
})

test('failed commands are reported from real exit codes and malformed events are survived', async () => {
  const sandbox = await createSandbox()
  const { app, page } = await sandbox.launch()
  try {
    await composer(page).fill('check [shell-fail] [malformed]')
    await page.getByRole('button', { name: 'Send message' }).click()
    const strip = page.getByLabel('Muse activity')
    await expect(strip).toContainText('Finished')
    await expect(strip).toContainText('exited with an error')
    await composer(page).fill('still responsive')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.locator('.agent-message').last()).toContainText('Echo: still responsive')
  } finally {
    await closeQuietly(app)
    await sandbox.dispose()
  }
})
