import { test, expect } from '@playwright/test'

test.describe('File browser directory UX', () => {
  test('shows deferred loading state for slow client navigation fetch', async ({ page }) => {
    await page.goto('/')
    await page.route('**/api/files**', async (route) => {
      const url = route.request().url()
      if (!url.includes(encodeURIComponent('Notes')) && !url.includes('dir=Notes')) {
        await route.continue()
        return
      }
      await new Promise((r) => setTimeout(r, 800))
      await route.continue()
    })
    await page.locator('table').getByText('Notes', { exact: true }).click()
    await expect(page).toHaveURL(/dir=Notes/)
    await expect(page.getByTestId('directory-loading')).toBeVisible()
  })

  test('manual retry recovers after automatic retries are exhausted', async ({ page }) => {
    let notesFetches = 0
    let failing = true
    await page.goto('/')
    await page.route('**/api/files**', async (route) => {
      const url = route.request().url()
      if (!url.includes('dir=Notes')) {
        await route.continue()
        return
      }
      notesFetches++
      if (failing) {
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
    expect(notesFetches).toBe(4)
    failing = false
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(page.locator('table').getByText('welcome.md').first()).toBeVisible()
  })

  test('automatically recovers a transient listing failure', async ({ page }) => {
    let notesFetches = 0
    await page.goto('/')
    await page.route('**/api/files**', async (route) => {
      if (route.request().url().includes('dir=Notes') && ++notesFetches === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'temporarily unavailable' }),
        })
        return
      }
      await route.continue()
    })
    await page.locator('table').getByText('Notes', { exact: true }).click()
    await expect(page.locator('table').getByText('welcome.md').first()).toBeVisible()
    expect(notesFetches).toBe(2)
    await expect(page.getByTestId('directory-list-error')).not.toBeVisible()
  })
})
