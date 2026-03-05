import { test, expect } from '@playwright/test'

test.describe('Folder Navigation', () => {
  test('shows all top-level folders at root', async ({ page }) => {
    await page.goto('/')
    const table = page.locator('table')
    for (const folder of [
      'Videos',
      'Music',
      'Images',
      'Documents',
      'Notes',
      'SharedContent',
      'EmptyFolder',
    ]) {
      await expect(table.getByText(folder, { exact: true })).toBeVisible()
    }
  })

  test('navigates into a folder on click', async ({ page }) => {
    await page.goto('/')
    await page.locator('table').getByText('Videos', { exact: true }).click()
    await page.waitForURL(/dir=Videos/)
    await expect(page.locator('table').getByText('sample.mp4')).toBeVisible()
  })

  test('navigates back via breadcrumbs', async ({ page }) => {
    await page.goto(`/?dir=${encodeURIComponent('Notes/subfolder')}`)
    await expect(page.locator('table').getByText('nested-note.md')).toBeVisible()
    await page.getByRole('button', { name: 'Notes', exact: true }).click()
    await page.waitForURL(/dir=Notes(?:&|$)/)
    await expect(page.locator('table').getByText('welcome.md')).toBeVisible()
  })

  test('navigates to parent using ".." row', async ({ page }) => {
    await page.goto('/?dir=Videos')
    await page.locator('table').getByText('..').first().click()
    await expect(page.locator('table').getByText('Videos', { exact: true })).toBeVisible()
  })

  test('navigates into nested folders', async ({ page }) => {
    await page.goto('/?dir=Notes')
    await page.locator('table').getByText('subfolder', { exact: true }).first().click()
    await page.waitForURL(/dir=Notes.*subfolder/)
    await expect(page.locator('table').getByText('nested-note.md')).toBeVisible()
  })

  test('switches to grid view and back', async ({ page }) => {
    await page.goto('/?dir=Videos')
    await expect(page.locator('table')).toBeVisible()

    await page.locator('button:has(.lucide-layout-grid)').click()
    await expect(page.locator('table')).not.toBeVisible()
    await expect(page.getByText('sample.mp4')).toBeVisible()

    await page.locator('button:has(.lucide-list)').click()
    await expect(page.locator('table')).toBeVisible()
  })

  test('shows empty state for empty folder', async ({ page }) => {
    await page.goto('/?dir=EmptyFolder')
    await expect(page.getByText('..')).toBeVisible()
    const dataRows = page.locator('table tbody tr')
    await expect(dataRows).toHaveCount(1)
  })

  test('favorites a file and sees it in Favorites virtual folder', async ({ page }) => {
    await page.goto('/?dir=Documents')
    const row = page.locator('table tr').filter({ hasText: 'readme.txt' })
    await row.hover()
    await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/api/settings/favorite') && resp.status() === 200,
      ),
      row.locator('button[title="Add to favorites"]').click(),
    ])

    await page.goto('/?dir=Favorites')
    await expect(page.getByText('readme.txt')).toBeVisible()

    // cleanup
    const favRow = page.locator('table tr').filter({ hasText: 'readme.txt' })
    await favRow.hover()
    await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/api/settings/favorite') && resp.status() === 200,
      ),
      favRow.locator('button[title="Remove from favorites"]').click(),
    ])
  })

  test('tracks views and shows Most Played', async ({ page }) => {
    await page.request.post('/api/stats/views', {
      data: { filePath: 'Documents/readme.txt' },
    })

    await page.goto('/?dir=Most Played')
    await expect(page.getByText('readme.txt')).toBeVisible()
  })

  test('loads folder from direct URL', async ({ page }) => {
    await page.goto('/?dir=Music')
    await expect(page.locator('table').getByText('track.mp3')).toBeVisible()
  })

  test('shows file metadata in list view', async ({ page }) => {
    await page.goto('/?dir=Documents')
    const row = page.locator('table tr').filter({ hasText: 'readme.txt' })
    await expect(row).toBeVisible()
    // File size cell should contain a number
    await expect(row).toContainText(/\d+\s*(B|KB|MB)/)
  })

  test('shows virtual folders at root', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Favorites')).toBeVisible()
    await expect(page.getByText('Most Played')).toBeVisible()
  })
})
