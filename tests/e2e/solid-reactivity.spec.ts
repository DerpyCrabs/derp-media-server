import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

function captureDiagnostics(page: Page) {
  const messages: string[] = []
  page.on('pageerror', (error) => messages.push(error.message))
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      messages.push(message.text())
    }
  })
  return {
    expectNone() {
      expect(messages, messages.join('\n')).toEqual([])
    },
  }
}

test('common application flows have no development warnings or errors', async ({ page }) => {
  const diagnostics = captureDiagnostics(page)

  await page.goto('/?dir=Documents')
  await page.getByRole('button', { name: 'Display options' }).click()
  await expect(page.getByTestId('explorer-display-options')).toBeVisible()
  await page.getByRole('menuitem', { name: 'Grid view' }).click()
  await page.getByRole('button', { name: 'Display options' }).click()
  await page.getByRole('menuitem', { name: 'List view' }).click()
  diagnostics.expectNone()

  await page.goto('/?dir=Videos')
  await page.getByText('sample.mp4', { exact: true }).click()
  await expect(page.locator('video')).toBeVisible()
  diagnostics.expectNone()

  await page.goto('/?dir=Documents&viewing=Documents%2Freader.epub')
  await expect(page.getByTestId('reader-book')).toBeVisible()
  await page.getByTestId('reader-settings-button').click()
  await expect(page.getByTestId('reader-settings')).toBeVisible()
  await page.getByLabel('Close reader').click()
  diagnostics.expectNone()

  await page.goto('/workspace')
  await page.getByRole('button', { name: 'Open settings' }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await page.keyboard.press('Escape')

  diagnostics.expectNone()
})

for (const entry of [
  { name: 'PDF viewer', query: 'viewing=Documents%2Freader.pdf', content: 'pdf-text-layer' },
  {
    name: 'reader dialog',
    query: 'reader=Documents%2Freader.epub&readerKind=book',
    content: 'reader-book',
  },
]) {
  test(`${entry.name} loads without development warnings or errors`, async ({ page }) => {
    const diagnostics = captureDiagnostics(page)
    await page.goto(`/?dir=Documents&${entry.query}`)
    await expect(page.getByTestId(entry.content).first()).toBeVisible()
    await page.getByLabel('Close reader').click()
    await expect(page.getByTestId(entry.content)).toHaveCount(0)
    diagnostics.expectNone()
  })
}
