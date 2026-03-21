import { test, expect, type Page } from '@playwright/test'
import { WORKSPACE_VISIBLE_WINDOW_GROUP, gotoWorkspace } from './workspace-layout-helpers'

function getBrowserContent(page: Page) {
  return page.locator(WORKSPACE_VISIBLE_WINDOW_GROUP).first().locator('.workspace-window-content')
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

  test('taskbar Show video restores workspace video after listen-only mode', async ({ page }) => {
    await gotoWorkspace(page)
    const content = getBrowserContent(page)
    await content.getByText('Videos', { exact: true }).click()
    await expect(content.getByText('sample.mp4')).toBeVisible()
    await content.getByText('sample.mp4').click()

    const videos = page.locator(`${WORKSPACE_VISIBLE_WINDOW_GROUP} video`)
    await expect(videos).toHaveCount(1)
    await videos.first().hover()
    await page.locator('button[title="Listen only"]').click()
    await expect(videos).toHaveCount(0)

    await page.getByRole('button', { name: 'Open audio controls' }).click()
    await page
      .locator('[data-workspace-taskbar-audio-root]')
      .getByRole('button', { name: 'Show video' })
      .click()
    await expect(page.locator(`${WORKSPACE_VISIBLE_WINDOW_GROUP} video`)).toHaveCount(1)
  })

  test('hiding snap template in workspace settings removes it from layout picker', async ({
    page,
  }) => {
    await gotoWorkspace(page)
    await page.getByRole('button', { name: 'Open settings' }).click()
    const settingsDialog = page.getByRole('dialog', { name: 'Settings' })
    await expect(settingsDialog).toBeVisible()
    await settingsDialog.getByRole('button', { name: 'Show all layouts' }).click()
    await page.keyboard.press('Escape')
    await expect(settingsDialog).not.toBeVisible()

    const groups = page.locator(WORKSPACE_VISIBLE_WINDOW_GROUP)
    const maximizeBtn = groups.first().locator('button:has(.lucide-maximize-2)')
    await maximizeBtn.click({ button: 'right' })
    await expect(page.getByText('Snap layout')).toBeVisible()
    const countBefore = await page.locator('[data-snap-layout-template]').count()
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Open settings' }).click()
    const dialogHide = page.getByRole('dialog', { name: 'Settings' })
    await dialogHide
      .getByTitle(/Shown in snap picker/)
      .first()
      .click()
    await page.keyboard.press('Escape')

    await maximizeBtn.click({ button: 'right' })
    await expect(page.getByText('Snap layout')).toBeVisible()
    await expect(page.locator('[data-snap-layout-template]')).toHaveCount(countBefore - 1)

    await page.getByRole('button', { name: 'Open settings' }).click()
    const dialogRestore = page.getByRole('dialog', { name: 'Settings' })
    await dialogRestore.getByRole('button', { name: 'Show all layouts' }).click()
    await page.keyboard.press('Escape')
  })
})
