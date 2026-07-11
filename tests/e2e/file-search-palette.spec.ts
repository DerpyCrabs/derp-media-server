import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { WORKSPACE_VISIBLE_WINDOW_GROUP } from './workspace-layout-helpers'

const workspaceContent = (page: Page) =>
  page.locator('[data-testid="workspace-window-visible-content"]:visible')

test.describe('File search palette', () => {
  test.describe.configure({ timeout: 30_000 })

  test('searches and navigates the classic browser', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('classic-file-search-trigger').click()
    const palette = page.getByTestId('file-search-palette')
    await expect(palette).toBeVisible()
    await palette.getByRole('combobox').fill('Videos')
    const result = palette.getByRole('option').filter({ hasText: 'Videos' }).first()
    await expect(result).toBeVisible({ timeout: 15_000 })
    await result.click()
    await page.waitForURL(/dir=.*Videos/)
    await expect(page.getByText('sample.mp4')).toBeVisible()
  })

  test('uses contextual and global workspace entry points', async ({ page }) => {
    await page.goto('/workspace')
    await expect(page.locator(WORKSPACE_VISIBLE_WINDOW_GROUP).first()).toBeVisible()

    const firstWindow = page.locator(WORKSPACE_VISIBLE_WINDOW_GROUP).first()
    await firstWindow.getByTestId('workspace-pane-file-search-trigger').click()
    let palette = page.getByTestId('file-search-palette')
    await palette.getByRole('combobox').fill('Images')
    await expect(palette.getByRole('option').filter({ hasText: 'Images' }).first()).toBeVisible({
      timeout: 15_000,
    })
    await palette.getByRole('option').filter({ hasText: 'Images' }).first().click()
    await expect(workspaceContent(page).getByText('photo.jpg')).toBeVisible()

    const countBefore = await page.locator(WORKSPACE_VISIBLE_WINDOW_GROUP).count()
    await page.getByTestId('workspace-global-file-search-trigger').click()
    palette = page.getByTestId('file-search-palette')
    await palette.getByRole('combobox').fill('Notes')
    await expect(palette.getByRole('option').filter({ hasText: 'Notes' }).first()).toBeVisible({
      timeout: 15_000,
    })
    await palette.getByRole('option').filter({ hasText: 'Notes' }).first().click()
    await expect(page.locator(WORKSPACE_VISIBLE_WINDOW_GROUP)).toHaveCount(countBefore + 1)
  })

  test('is touch accessible and absent from share UI', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.getByTestId('classic-file-search-trigger').click()
    const palette = page.getByTestId('file-search-palette')
    await expect(palette).toBeVisible()
    await expect(palette.getByRole('combobox')).toBeFocused()
    await palette.getByRole('button', { name: 'Close search' }).click()

    await page.goto('/share/test-passcode-share-token1')
    await expect(page.getByTestId('classic-file-search-trigger')).toHaveCount(0)
    await expect(page.getByTestId('workspace-global-file-search-trigger')).toHaveCount(0)
  })
})
