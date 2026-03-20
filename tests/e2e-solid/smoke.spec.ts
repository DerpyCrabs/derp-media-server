import { test, expect } from '@playwright/test'

test.describe('Solid smoke', () => {
  test('home shows Solid shell when authenticated', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('file-browser')).toBeVisible()
  })
})
