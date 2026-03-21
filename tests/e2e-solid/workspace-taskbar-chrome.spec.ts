import { test, expect, type Page } from '@playwright/test'

async function gotoWorkspace(page: Page) {
  await page.goto('/workspace')
  await expect(page.locator('[data-window-group]')).toBeVisible()
}

function getBrowserContent(page: Page) {
  return page.locator('[data-window-group]').first().locator('.workspace-window-content')
}

test.describe('Workspace taskbar chrome', () => {
  test('taskbar audio shows current track after playing mp3 from browser', async ({ page }) => {
    await gotoWorkspace(page)
    const content = getBrowserContent(page)
    await content.getByText('Music', { exact: true }).click()
    await content.locator('table').getByText('track.mp3').click()
    const audioControls = page.getByRole('button', { name: 'Open audio controls' })
    await expect(audioControls).toBeVisible()
    await expect(audioControls).toContainText('track.mp3')
  })

  test('persists dark mode from workspace taskbar settings after reload', async ({ page }) => {
    await gotoWorkspace(page)
    await page.getByRole('button', { name: 'Open settings' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Dark' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', /dark/)
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', /dark/)
  })
})
