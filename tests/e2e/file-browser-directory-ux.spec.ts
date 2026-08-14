import { test, expect } from '@playwright/test'
import { libraryUrl } from './canonical-urls'

test.describe('File browser directory UX', () => {
  test('shows deferred loading state for slow client navigation fetch', async ({ page }) => {
    await page.goto('/')
    await page.route('**/api/integrations/filesystem/browse?*', async (route) => {
      const url = route.request().url()
      if (!new URL(url).searchParams.get('id')?.includes('Notes')) {
        await route.continue()
        return
      }
      await new Promise((r) => setTimeout(r, 800))
      await route.continue()
    })
    await page.locator('table').getByText('Notes', { exact: true }).click()
    await expect(page).toHaveURL(libraryUrl('Notes'))
    await expect(page.getByTestId('directory-loading')).toBeVisible()
  })

  test('retry refetches listing after error on client navigation', async ({ page }) => {
    let notesFetches = 0
    await page.goto('/')
    await page.route('**/api/integrations/filesystem/browse?*', async (route) => {
      const url = route.request().url()
      if (!new URL(url).searchParams.get('id')?.includes('Notes')) {
        await route.continue()
        return
      }
      notesFetches++
      if (notesFetches === 1) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'test failure' }),
        })
        return
      }
      await route.continue()
    })
    await page.locator('table').getByText('Notes', { exact: true }).click()
    await expect(page.getByTestId('directory-list-error')).toBeVisible()
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(page.locator('table').getByText('welcome.md').first()).toBeVisible()
  })
})
