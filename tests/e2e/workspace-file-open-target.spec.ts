import { test, expect, type Page } from '@playwright/test'
import { getWindowGroups, gotoWorkspace } from './workspace-layout-helpers'

function getBrowserContent(page: Page) {
  return getWindowGroups(page).first().locator('.workspace-window-content')
}

async function chooseWorkspaceOpenTarget(page: Page, label: 'New tab' | 'New window') {
  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Settings' }) })
  await dialog.getByRole('button', { name: label }).click()
  await page.keyboard.press('Escape')
}

test.describe('Workspace file open target', () => {
  test('opens file in a new tab when setting is New tab', async ({ page }) => {
    await gotoWorkspace(page)
    await page.getByRole('button', { name: 'Open settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await chooseWorkspaceOpenTarget(page, 'New tab')

    const content = getBrowserContent(page)
    await content.getByText('Documents', { exact: true }).click()
    await expect(content.getByText('readme.txt')).toBeVisible({ timeout: 10_000 })
    await content.getByText('readme.txt').click()

    await expect(getWindowGroups(page)).toHaveCount(1)
    const tabStrip = page.locator('.workspace-tab-strip')
    await expect(tabStrip.getByText('readme.txt')).toBeVisible()
  })

  test('opens file in a new window when setting is New window', async ({ page }) => {
    await gotoWorkspace(page)
    await page.getByRole('button', { name: 'Open settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await chooseWorkspaceOpenTarget(page, 'New window')

    const content = getBrowserContent(page)
    await content.getByText('Documents', { exact: true }).click()
    await expect(content.getByText('readme.txt')).toBeVisible({ timeout: 10_000 })
    await expect(getWindowGroups(page)).toHaveCount(1)
    await content.getByText('readme.txt').click()
    await expect(getWindowGroups(page)).toHaveCount(2)
  })
})
