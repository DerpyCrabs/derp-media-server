import { test, expect } from '@playwright/test'

test.describe('Knowledge Base', () => {
  test('shows search input in KB folders', async ({ page }) => {
    await page.goto('/?dir=Notes')
    await expect(page.locator('input[type="search"][placeholder*="Search"]')).toBeVisible()
  })

  test('searches notes and shows results', async ({ page }) => {
    await page.goto('/?dir=Notes')
    const searchInput = page.locator('input[type="search"][placeholder*="Search"]')
    await searchInput.fill('welcome')
    // Wait for search results to appear
    await expect(page.getByText('welcome.md')).toBeVisible()
  })

  test('shows recent notes', async ({ page }) => {
    await page.goto('/?dir=Notes')
    // The KB dashboard shows recently modified notes
    // Recent notes should include our fixture files
    await expect(page.getByText('welcome.md')).toBeVisible()
    await expect(page.getByText('todo.md')).toBeVisible()
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
    await page.locator('[data-slot="context-menu-item"]').getByText('Set as Knowledge Base').click()

    // Navigate into the folder — should now show search
    await page.locator('table').getByText('SharedContent', { exact: true }).click()
    await page.waitForURL(/dir=SharedContent/)
    await expect(page.locator('input[type="search"][placeholder*="Search"]')).toBeVisible()

    // Toggle off
    await page.goto('/')
    await page.locator('table tr').filter({ hasText: 'SharedContent' }).click({ button: 'right' })
    await page.locator('[data-slot="context-menu-item"]').getByText('Remove Knowledge Base').click()
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

  test('sets a custom icon on a folder', async ({ page }) => {
    await page.goto('/')
    await page.locator('table tr').filter({ hasText: 'Notes' }).click({ button: 'right' })
    await page.locator('[data-slot="context-menu-item"]').getByText('Set icon').click()

    // Icon editor dialog should appear
    await expect(page.getByText('Set Custom Icon')).toBeVisible()

    // Pick an icon
    const iconButton = page.locator('button[title]').filter({ hasText: '' }).first()
    await iconButton.click()

    await page.getByRole('button', { name: 'Save' }).click()
  })
})
