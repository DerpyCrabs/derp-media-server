import { test, expect } from '@playwright/test'

test.describe('PDF Viewer', () => {
  test('opens PDF viewer when clicking a PDF file', async ({ page }) => {
    await page.goto('/?dir=Documents')
    await page.locator('table').getByText('sample.pdf').click()
    await expect(page.getByTestId('pdf-canvas')).toBeVisible()
  })

  test('shows PDF filename in header', async ({ page }) => {
    await page.goto('/?dir=Documents&viewing=Documents%2Fsample.pdf')
    await expect(page.getByText('sample.pdf').first()).toBeVisible()
  })

  test('shows download button', async ({ page }) => {
    await page.goto('/?dir=Documents&viewing=Documents%2Fsample.pdf')
    await expect(page.locator('[title="Download"]')).toBeVisible()
  })

  test('shows page navigation and zoom controls', async ({ page }) => {
    await page.goto('/?dir=Documents&viewing=Documents%2Fsample.pdf')
    await expect(page.getByRole('button', { name: 'Next page' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible()
  })

  test('closing viewer returns to file list', async ({ page }) => {
    await page.goto('/?dir=Documents&viewing=Documents%2Fsample.pdf')
    await expect(page.getByTestId('pdf-canvas')).toBeVisible()

    await page.locator('button[title="Close"]').click()
    await expect(page.getByTestId('pdf-canvas')).not.toBeVisible()
    await expect(page.locator('table').getByText('sample.pdf')).toBeVisible()
    await expect(page).not.toHaveURL(/viewing=/)
  })
})
