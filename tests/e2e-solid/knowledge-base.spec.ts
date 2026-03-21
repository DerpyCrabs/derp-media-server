import { test, expect } from '@playwright/test'

test.describe('Knowledge Base', () => {
  test('shows search input in KB folders', async ({ page }) => {
    await page.goto('/?dir=Notes')
    await page.getByRole('button', { name: 'Open search' }).click()
    await expect(page.locator('input[type="search"][placeholder*="Search"]')).toBeVisible()
  })

  test('searches notes and shows results', async ({ page }) => {
    await page.goto('/?dir=Notes')
    await page.getByRole('button', { name: 'Open search' }).click()
    const searchInput = page.locator('input[type="search"][placeholder*="Search"]')
    await searchInput.fill('welcome')
    // Wait for search results to appear
    await expect(page.getByText('welcome.md')).toBeVisible()
  })

  test('shows recent notes', async ({ page }) => {
    await page.goto('/?dir=Notes')
    await expect(page.getByTestId('kb-recent-strip')).toBeVisible()
    // The KB dashboard shows recently modified notes
    // Recent notes should include our fixture files (may appear in recent list and file list)
    await expect(page.locator('table').getByText('welcome.md').first()).toBeVisible()
    await expect(page.locator('table').getByText('todo.md').first()).toBeVisible()
  })

  test('defaults to .md extension when creating files in KB', async ({ page }) => {
    await page.goto('/?dir=Notes')
    await page.locator('button[title="Create new file"]').click()
    // Dialog description mentions .md extension
    await expect(page.getByText('.md extension will be added')).toBeVisible()
  })

  test('toggles KB on a folder via context menu', async ({ page }) => {
    await page.goto('/')
    await page.locator('table tr').filter({ hasText: 'SharedContent' }).click({ button: 'right' })
    // Should show "Set as Knowledge Base" since it's not a KB
    const setKbItem = page
      .locator('[data-slot="context-menu-item"]')
      .getByText('Set as Knowledge Base')
    await expect(setKbItem).toBeVisible()
    await setKbItem.click({ noWaitAfter: true })

    // Navigate into the folder — should now show search
    await page.locator('table').getByText('SharedContent', { exact: true }).click()
    await page.waitForURL(/dir=SharedContent/)
    await page.getByRole('button', { name: 'Open search' }).click()
    await expect(page.locator('input[type="search"][placeholder*="Search"]')).toBeVisible()

    // Toggle off
    await page.goto('/')
    await page.locator('table tr').filter({ hasText: 'SharedContent' }).click({ button: 'right' })
    const removeKbItem = page
      .locator('[data-slot="context-menu-item"]')
      .getByText('Remove Knowledge Base')
    await expect(removeKbItem).toBeVisible()
    await removeKbItem.click({ noWaitAfter: true })
  })

  test('renders Obsidian-style ![[image]] embeds', async ({ page }) => {
    await page.goto('/?dir=Notes')
    await page.locator('table').getByText('welcome.md').click()
    // Notes is editable, so the file opens in edit mode — switch to read-only
    await page.getByRole('button', { name: 'Read only' }).click()
    // welcome.md contains ![[diagram.png]] which should render as an <img>
    const img = page.locator('.prose img')
    await expect(img).toBeVisible()
    const src = await img.getAttribute('src')
    expect(src).toContain('images')
    expect(src).toContain('diagram.png')
  })

  test('shows knowledge-base root icon marker on KB folder rows', async ({ page }) => {
    await page.goto('/')
    const notesRow = page.locator('table tbody tr').filter({ hasText: /^Notes$/ })
    await expect(notesRow.locator('[data-kb-root-icon]')).toBeVisible()
  })

  test('sets a custom icon on a folder', async ({ page }) => {
    await page.goto('/')
    await page.locator('table tr').filter({ hasText: 'Notes' }).click({ button: 'right' })
    await page.locator('[data-slot="context-menu-item"]').getByText('Set icon').click()

    // Icon editor dialog should appear (use data-slot to avoid matching ThemeSwitcher's button[title])
    const dialog = page
      .locator('[data-slot="dialog-content"]')
      .filter({ hasText: 'Set Custom Icon' })
    await expect(dialog).toBeVisible()

    // Pick an icon — scoped to dialog
    const iconButton = dialog.locator('button[title]').first()
    await iconButton.click()

    await page.getByRole('button', { name: 'Save' }).click()
  })
})
