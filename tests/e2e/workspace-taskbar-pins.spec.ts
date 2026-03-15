import { test, expect, type Page } from '@playwright/test'

async function gotoWorkspace(page: Page) {
  await page.goto('/workspace')
  await expect(page.locator('[data-window-group]')).toBeVisible()
}

function getWindowGroups(page: Page) {
  return page.locator('[data-window-group]')
}

function getBrowserContent(page: Page) {
  return getWindowGroups(page).first().locator('.workspace-window-content')
}

test.describe('Workspace taskbar pins', () => {
  test('Add to taskbar from context menu adds pinned icon', async ({ page }) => {
    await gotoWorkspace(page)
    const content = getBrowserContent(page)
    await expect(content.getByText('Documents', { exact: true })).toBeVisible()
    await content
      .locator('table tr')
      .filter({ hasText: 'Documents' })
      .first()
      .click({ button: 'right' })
    await page.locator('[data-slot="context-menu-item"]').getByText('Add to taskbar').click()

    await expect(page.locator('button[title="Folder: Documents"]')).toBeVisible()
  })

  test('clicking pinned folder icon opens browser at that folder', async ({ page }) => {
    await gotoWorkspace(page)
    const content = getBrowserContent(page)
    await content
      .locator('table tr')
      .filter({ hasText: 'Documents' })
      .first()
      .click({ button: 'right' })
    await page.locator('[data-slot="context-menu-item"]').getByText('Add to taskbar').click()

    await expect(page.locator('button[title="Folder: Documents"]')).toBeVisible()
    await page.locator('button[title="Folder: Documents"]').click()

    await expect(getWindowGroups(page)).toHaveCount(2)
    const secondContent = getWindowGroups(page).nth(1).locator('.workspace-window-content')
    await expect(secondContent.getByText('readme.txt')).toBeVisible()
  })

  test('Unpin from context menu removes pinned icon', async ({ page }) => {
    await gotoWorkspace(page)
    const content = getBrowserContent(page)
    await content
      .locator('table tr')
      .filter({ hasText: 'Documents' })
      .first()
      .click({ button: 'right' })
    await page.locator('[data-slot="context-menu-item"]').getByText('Add to taskbar').click()

    await expect(page.locator('button[title="Folder: Documents"]')).toBeVisible()
    await page.locator('button[title="Folder: Documents"]').click({ button: 'right' })
    await page.locator('[data-slot="context-menu-item"]').getByText('Unpin').click()

    await expect(page.locator('button[title="Folder: Documents"]')).not.toBeVisible()
  })

  test('clicking pinned file icon opens viewer for that file', async ({ page }) => {
    await gotoWorkspace(page)
    const content = getBrowserContent(page)
    await content.getByText('Documents', { exact: true }).click()
    await expect(content.getByText('readme.txt')).toBeVisible()
    await content.locator('table tr').filter({ hasText: 'readme.txt' }).click({ button: 'right' })
    await page.locator('[data-slot="context-menu-item"]').getByText('Add to taskbar').click()

    await expect(page.locator('button[title="File: Documents/readme.txt"]')).toBeVisible()
    await page.locator('button[title="File: Documents/readme.txt"]').click()

    await expect(getWindowGroups(page)).toHaveCount(2)
    const viewerContent = getWindowGroups(page).nth(1).locator('.workspace-window-content')
    await expect(viewerContent.getByText('readme', { exact: false })).toBeVisible({
      timeout: 5_000,
    })
  })

  test('clicking pinned unsupported file shows unsupported file viewer', async ({ page }) => {
    await gotoWorkspace(page)
    const content = getBrowserContent(page)
    await content.getByText('Documents', { exact: true }).click()
    await expect(content.getByText('unsupported.xyz')).toBeVisible()
    await content
      .locator('table tr')
      .filter({ hasText: 'unsupported.xyz' })
      .click({ button: 'right' })
    await page.locator('[data-slot="context-menu-item"]').getByText('Add to taskbar').click()

    await expect(page.locator('button[title="File: Documents/unsupported.xyz"]')).toBeVisible()
    await page.locator('button[title="File: Documents/unsupported.xyz"]').click()

    await expect(getWindowGroups(page)).toHaveCount(2)
    const viewerContent = getWindowGroups(page).nth(1).locator('.workspace-window-content')
    await expect(viewerContent.getByText('This file type cannot be previewed.')).toBeVisible({
      timeout: 5_000,
    })
    await expect(viewerContent.getByRole('link', { name: 'Download File' })).toBeVisible()
  })
})
