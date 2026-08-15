import { expect, test } from '@playwright/test'
import { WORKSPACE_VISIBLE_WINDOW_GROUP } from './workspace-layout-helpers'

test.describe('File search palette', () => {
  test.describe.configure({ timeout: 45_000 })

  test('searches and navigates the classic browser', async ({ page }) => {
    await page.goto('/')
    await expect
      .poll(
        async () => {
          const response = await page.request.get('/api/files/search?q=Videos&limit=20')
          const payload = (await response.json()) as { results?: Array<{ name: string }> }
          return payload.results?.map((result) => result.name) ?? []
        },
        { timeout: 30_000 },
      )
      .toContain('Videos')
    await page.getByTestId('classic-file-search-trigger').click()
    const palette = page.getByTestId('file-search-palette')
    await expect(palette).toBeVisible()
    const searchInput = palette.getByRole('combobox')
    await expect(searchInput).toHaveAttribute('type', 'text')
    await searchInput.fill('Videos')
    const result = palette.getByRole('option').filter({ hasText: 'Videos' }).first()
    await expect(result).toBeVisible({ timeout: 15_000 })
    await result.click()
    await page.waitForURL(/dir=.*Videos/)
    await expect(page.getByText('sample.mp4')).toBeVisible()
  })

  test('uses only the global workspace entry point', async ({ page }) => {
    await page.goto('/workspace')
    await expect(page.locator(WORKSPACE_VISIBLE_WINDOW_GROUP).first()).toBeVisible()
    await expect(page.getByTestId('workspace-pane-file-search-trigger')).toHaveCount(0)

    const countBefore = await page.locator(WORKSPACE_VISIBLE_WINDOW_GROUP).count()
    await page.getByTestId('workspace-global-file-search-trigger').click()
    const palette = page.getByTestId('file-search-palette')
    await palette.getByRole('combobox').fill('Notes')
    await expect(palette.getByRole('option').filter({ hasText: 'Notes' }).first()).toBeVisible({
      timeout: 15_000,
    })
    await palette.getByRole('option').filter({ hasText: 'Notes' }).first().click()
    await expect(page.locator(WORKSPACE_VISIBLE_WINDOW_GROUP)).toHaveCount(countBefore + 1)
  })

  test('is touch accessible', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.getByTestId('classic-file-search-trigger').click()
    const palette = page.getByTestId('file-search-palette')
    await expect(palette).toBeVisible()
    await expect(palette.getByRole('combobox')).toBeFocused()
    await palette.getByRole('button', { name: 'Close search' }).click()
  })
})
