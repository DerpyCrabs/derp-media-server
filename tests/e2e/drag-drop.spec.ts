import { test, expect } from '@playwright/test'
import { libraryUrl } from './canonical-urls'

test.describe('Drag and Drop File Moving', () => {
  test('drags a file into a folder', async ({ page }) => {
    await page.goto(libraryUrl('MediaContent'))

    // Create a temp file to drag
    await page.locator('button[title="Create new file"]').click()
    await page.locator('input[placeholder*="File name"]').fill('drag-test.txt')
    await page.getByRole('button', { name: 'Create' }).click()
    await page.locator('button[title="Close"]').click()
    await expect(page.locator('table').getByText('drag-test.txt')).toBeVisible()

    const sourceRow = page.locator('table tr').filter({ hasText: 'drag-test.txt' })
    const targetRow = page.locator('table tr').filter({ hasText: 'subfolder' }).first()

    await sourceRow.dragTo(targetRow)

    // File should disappear from current view
    await expect(page.locator('table').getByText('drag-test.txt')).not.toBeVisible({
      timeout: 5_000,
    })

    // File should be in the subfolder
    await page.locator('table').getByText('subfolder').first().click()
    await page.waitForURL(libraryUrl('MediaContent/subfolder'))
    await expect(page.locator('table').getByText('drag-test.txt')).toBeVisible()

    // Cleanup: delete the file
    await page.locator('table tr').filter({ hasText: 'drag-test.txt' }).click({ button: 'right' })
    await page.locator('[data-slot="context-menu-item"]').getByText('Delete').click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
  })
})
