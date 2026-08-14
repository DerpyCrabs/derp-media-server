import { test, expect } from '@playwright/test'
import { libraryUrl, workspaceUrl } from './canonical-urls'

test.describe('Folder Navigation', () => {
  test('shows all top-level folders at root', async ({ page }) => {
    await page.goto('/')
    const table = page.locator('table')
    await Promise.all(
      ['Videos', 'Music', 'Images', 'Documents', 'Notes', 'MediaContent', 'EmptyFolder'].map(
        (folder) => expect(table.getByText(folder, { exact: true })).toBeVisible(),
      ),
    )
  })

  test('navigates into a folder on click', async ({ page }) => {
    await page.goto('/')
    await page.locator('table').getByText('Videos', { exact: true }).click()
    await page.waitForURL(libraryUrl('Videos'))
    await expect(page.locator('table').getByText('sample.mp4')).toBeVisible()
  })

  test('navigates back via breadcrumbs', async ({ page }) => {
    await page.goto(libraryUrl('Notes/subfolder'))
    await expect(page.locator('table').getByText('nested-note.md')).toBeVisible()
    await page.getByRole('button', { name: 'Notes', exact: true }).click()
    await page.waitForURL(libraryUrl('Notes'))
    await expect(page.locator('table').getByText('welcome.md')).toBeVisible()
  })

  test('breadcrumb folder context menu includes Set icon and workspace actions', async ({
    page,
  }) => {
    await page.goto(libraryUrl('Notes/subfolder'))
    await expect(page.locator('table').getByText('nested-note.md')).toBeVisible()
    await page.locator('[data-breadcrumb-path="Notes"]').click({ button: 'right' })
    await expect(page.getByTestId('breadcrumb-menu-set-icon')).toBeVisible()
    await expect(page.getByTestId('breadcrumb-menu-open-workspace')).toBeVisible()
    await expect(page.getByTestId('breadcrumb-menu-open-new-tab')).toBeVisible()
  })

  test('navigates to parent using ".." row', async ({ page }) => {
    await page.goto(libraryUrl('Videos'))
    await page.locator('table').getByText('..').first().click()
    await expect(page.locator('table').getByText('Videos', { exact: true })).toBeVisible()
  })

  test('navigates into nested folders', async ({ page }) => {
    await page.goto(libraryUrl('Notes'))
    await page.locator('table').getByText('subfolder', { exact: true }).first().click()
    await page.waitForURL(libraryUrl('Notes/subfolder'))
    await expect(page.locator('table').getByText('nested-note.md')).toBeVisible()
  })

  test('switches to grid view and back', async ({ page }) => {
    await page.goto(libraryUrl('Videos'))
    await expect(page.locator('table')).toBeVisible()

    await page.locator('button:has(.lucide-layout-grid)').click()
    await expect(page.locator('table')).not.toBeVisible()
    await expect(page.getByText('sample.mp4')).toBeVisible()

    await page.locator('button:has(.lucide-list)').click()
    await expect(page.locator('table')).toBeVisible()
  })

  test('shows empty state for empty folder', async ({ page }) => {
    await page.goto(libraryUrl('EmptyFolder'))
    await expect(page.getByText('..', { exact: true })).toBeVisible()
    await expect(page.getByTestId('directory-empty')).toBeVisible()
    await expect(page.getByText('This folder is empty')).toBeVisible()
    const dataRows = page.locator('table tbody tr')
    await expect(dataRows).toHaveCount(2)
  })

  test('favorites a file and sees it in Favorites virtual folder', async ({ page }) => {
    await page.goto(libraryUrl('Documents'))
    const row = page.locator('table tr').filter({ hasText: 'readme.txt' })
    await row.hover()
    await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/api/settings/favorite') && resp.status() === 200,
      ),
      row.locator('button[title="Add to favorites"]').click(),
    ])

    await page.goto(libraryUrl('Favorites'))
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
    const res = await page.request.post('/api/stats/views', {
      data: { filePath: 'Documents/readme.txt' },
    })
    expect(res.ok()).toBeTruthy()

    await page.goto(libraryUrl('Most Played'))
    await expect(page.locator('table').getByText('readme.txt')).toBeVisible()
  })

  test('loads folder from direct URL', async ({ page }) => {
    await page.goto(libraryUrl('Music'))
    await expect(page.locator('table').getByText('track.mp3')).toBeVisible()
  })

  test('shows file metadata in list view', async ({ page }) => {
    await page.goto(libraryUrl('Documents'))
    const row = page.locator('table tr').filter({ hasText: 'readme.txt' })
    await expect(row).toBeVisible()
    // File size cell should contain a number
    await expect(row).toContainText(/\d+\s*(B|KB|MB)/)
  })

  test('increments view count when opening a file in list view', async ({ page }) => {
    await page.goto(libraryUrl('Documents'))
    await page.locator('table').getByText('readme.txt', { exact: true }).click()
    await expect(page).toHaveURL(/viewing=/)
    const row = page.locator('table tr').filter({ hasText: 'readme.txt' })
    await expect(row.locator('[data-testid=file-view-count]')).toHaveText(/[1-9]/)
  })

  test('shows virtual folders at root', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Favorites')).toBeVisible()
    await expect(page.getByText('Most Played')).toBeVisible()
  })

  test('context menu Open in Workspace targets the canonical folder resource', async ({ page }) => {
    await page.goto('/')
    await page.locator('table').getByText('Documents', { exact: true }).click({ button: 'right' })
    await expect(
      page.locator('[data-slot="context-menu-item"]').getByText('Open in Workspace'),
    ).toBeVisible()

    await page.evaluate(() => {
      const w = window as Window & { __workspaceMenuOpenUrl?: string }
      w.open = (url?: string | URL) => {
        w.__workspaceMenuOpenUrl = typeof url === 'string' ? url : String(url ?? '')
        return null
      }
    })
    await page.locator('[data-slot="context-menu-item"]').getByText('Open in Workspace').click()
    const captured = await page.evaluate(
      () => (window as Window & { __workspaceMenuOpenUrl?: string }).__workspaceMenuOpenUrl ?? '',
    )
    expect(captured).toContain(workspaceUrl('Documents'))
  })

  test('favorites a folder via context menu and removes from Favorites', async ({ page }) => {
    await page.goto('/')
    await page.locator('table').getByText('Notes', { exact: true }).click({ button: 'right' })
    await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/api/settings/favorite') && resp.status() === 200,
      ),
      page.locator('[data-slot="context-menu-item"]').getByText('Favorite').click(),
    ])

    await page.goto(libraryUrl('Favorites'))
    await expect(page.getByText('Notes').first()).toBeVisible()

    await page.locator('table').getByText('Notes', { exact: true }).click({ button: 'right' })
    await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/api/settings/favorite') && resp.status() === 200,
      ),
      page.locator('[data-slot="context-menu-item"]').getByText('Unfavorite').click(),
    ])
  })

  test('unsupported file from URL shows dialog and close clears viewing', async ({ page }) => {
    await page.goto(libraryUrl('Documents'))
    await page.locator('table').getByText('unsupported.xyz').click()
    await page.waitForURL(/viewing=/)
    await expect(page.getByRole('heading', { name: 'Unsupported File Type' })).toBeVisible()
    await page.getByRole('button', { name: 'Close' }).click()
    await expect(page).not.toHaveURL(/viewing=/)
    await expect(page.locator('table').getByText('unsupported.xyz')).toBeVisible()
  })
})

test.describe('Application surface navigation', () => {
  test('switches surfaces without reloading and restores deep-link state with browser history', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const key = 'surface-navigation-document-loads'
      const count = Number(sessionStorage.getItem(key) ?? '0') + 1
      sessionStorage.setItem(key, String(count))
    })
    await page.goto(libraryUrl('Music'))

    const switcher = page.getByRole('navigation', { name: 'Application surfaces' })
    await expect(switcher).toBeVisible()
    await switcher.getByRole('link', { name: 'Workspace' }).click()
    await expect(page.locator('.workspace-layout')).toBeVisible()
    await expect.poll(() => page.url()).toContain(workspaceUrl('Music'))

    await switcher.getByRole('link', { name: 'Canvas' }).click()
    await expect(page.locator('.canvas-layout')).toBeVisible()
    await expect(page).toHaveURL(/\/canvas$/)

    await page.goBack()
    await expect(page.locator('.workspace-layout')).toBeVisible()
    await expect.poll(() => page.url()).toContain(workspaceUrl('Music'))

    await page.goBack()
    await expect(page.getByTestId('file-browser')).toBeVisible()
    await expect(page).toHaveURL(libraryUrl('Music'))
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem('surface-navigation-document-loads')))
      .toBe('1')
  })

  test('flushes Workspace state before an immediate surface switch', async ({ page }) => {
    await page.goto('/workspace?ws=surface-switch-flush')
    await expect(page.locator('[data-window-group]').first()).toBeVisible()
    const windows = page.locator('[data-window-group]')
    const initialCount = await windows.count()
    await page.getByRole('button', { name: 'Open browser window' }).click()
    await expect(windows).toHaveCount(initialCount + 1)

    await page
      .getByRole('navigation', { name: 'Application surfaces' })
      .getByRole('link', { name: 'Library' })
      .click()
    await expect(page.getByTestId('file-browser')).toBeVisible()
    await page.goBack()
    await expect(page.locator('.workspace-layout')).toBeVisible()
    await expect(page.locator('[data-window-group]')).toHaveCount(initialCount + 1)
  })

  test('shows a frontend not-found state for an unknown path', async ({ page }) => {
    await page.goto(libraryUrl('Music').replace(/^\//, '/missing/path'))

    await expect(page.getByTestId('not-found')).toBeVisible()
    await expect(page.getByTestId('file-browser')).toHaveCount(0)
    await page.getByRole('link', { name: 'Open Library' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByTestId('file-browser')).toBeVisible()
  })

  test('keeps surface switcher off narrow mobile Library', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')

    await expect(page.getByTestId('surface-switcher')).toBeHidden()
    await expect(page.getByTestId('file-browser')).toBeVisible()
  })

  test('clears unavailable Reader, viewer, and playback deep links', async ({ page }) => {
    const [readerInspect] = await Promise.all([
      page.waitForResponse((response) =>
        response.url().includes('/api/integrations/filesystem/inspect?'),
      ),
      page.goto('/?reader=Documents%2Fmissing.pdf&readerKind=pdf'),
    ])
    expect(readerInspect.status()).toBe(404)
    await expect.poll(() => new URL(page.url()).searchParams.has('reader')).toBe(false)
    await expect(page.getByTestId('file-browser')).toBeVisible()

    await page.goto('/?viewing=Documents%2Fmissing.txt')
    await expect.poll(() => new URL(page.url()).searchParams.has('viewing')).toBe(false)
    await expect(page.getByTestId('file-browser')).toBeVisible()

    await page.goto('/?playing=Music%2Fmissing.mp3')
    await expect.poll(() => new URL(page.url()).searchParams.has('playing')).toBe(false)
    await expect(page.getByTestId('file-browser')).toBeVisible()
  })
})
