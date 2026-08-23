import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

const STRICT_READ = '[STRICT_READ_UNTRACKED]'

function captureStrictReads(page: Page) {
  const messages: string[] = []
  const capture = (message: ConsoleMessage) => {
    if (message.type() === 'warning' && message.text().includes(STRICT_READ)) {
      messages.push(message.text())
    }
  }
  page.on('console', capture)
  return {
    expectNone() {
      expect(messages, messages.join('\n')).toEqual([])
    },
  }
}

test('common application flows have no untracked Solid reads', async ({ page }) => {
  const diagnostics = captureStrictReads(page)

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
