import { test, expect } from '@playwright/test'
import { libraryUrl } from './canonical-urls'

test.describe('PDF Viewer', () => {
  test('opens PDF viewer when clicking a PDF file', async ({ page }) => {
    await page.goto(libraryUrl('Documents'))
    await page.locator('table').getByText('sample.pdf').click()
    await expect(page.getByTestId('pdf-canvas')).toBeVisible()
  })

  test('does not duplicate PDF filename in reader toolbar', async ({ page }) => {
    await page.goto(libraryUrl('Documents', { viewing: 'Documents/sample.pdf' }))
    await expect(page.getByTestId('reader-dialog').locator('header')).not.toContainText(
      'sample.pdf',
    )
  })

  test('uses compact derp-reader toolbar controls', async ({ page }) => {
    await page.goto(libraryUrl('Documents', { viewing: 'Documents/sample.pdf' }))
    await expect(page.getByTestId('reader-page-indicator')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Enter fullscreen' })).toBeVisible()
    await expect(page.locator('[title="Download"]')).not.toBeVisible()
  })

  test('shows page jump and zoom controls', async ({ page }) => {
    await page.goto(libraryUrl('Documents', { viewing: 'Documents/sample.pdf' }))
    await page.getByTestId('reader-page-indicator').click()
    await expect(page.getByTestId('reader-page-input')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByTestId('reader-settings-button').click()
    await expect(page.getByRole('button', { name: 'Reader zoom in' })).toBeVisible()
  })

  test('closing viewer returns to file list', async ({ page }) => {
    await page.goto(libraryUrl('Documents', { viewing: 'Documents/sample.pdf' }))
    await expect(page.getByTestId('pdf-canvas')).toBeVisible()

    await page.locator('button[title="Close"]').click()
    await expect(page.getByTestId('pdf-canvas')).not.toBeVisible()
    await expect(page.locator('table').getByText('sample.pdf')).toBeVisible()
    await expect(page).not.toHaveURL(/viewing=/)
  })
})
