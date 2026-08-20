import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { getWindowGroups, gotoWorkspace } from './workspace-layout-helpers'
import { createWorkspaceE2EContext } from './workspace-e2e-context'

let sharedContext: BrowserContext
let page: Page

test.beforeAll(async ({ browser }) => {
  sharedContext = await createWorkspaceE2EContext(browser)
})

test.afterAll(async () => {
  await sharedContext.close()
})

test.beforeEach(async () => {
  page = await sharedContext.newPage()
})

test.afterEach(async () => {
  await page.close()
})

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
  test('opens file in a new tab when setting is New tab', async () => {
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

  test('opens file in a new window when setting is New window', async () => {
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

  test('applies file and layout preferences live across tabs', async () => {
    const secondPage = await sharedContext.newPage()
    try {
      await Promise.all([gotoWorkspace(page), gotoWorkspace(secondPage)])

      await page.getByRole('button', { name: 'Open settings' }).click()
      await chooseWorkspaceOpenTarget(page, 'New tab')

      await secondPage.getByRole('button', { name: 'Open settings' }).click()
      const secondDialog = secondPage
        .getByRole('dialog')
        .filter({ has: secondPage.getByRole('heading', { name: 'Settings' }) })
      await expect(secondDialog.getByRole('button', { name: 'New tab' })).toHaveClass(
        /border-primary/,
      )

      await page.getByRole('button', { name: 'Open settings' }).click()
      const firstDialog = page
        .getByRole('dialog')
        .filter({ has: page.getByRole('heading', { name: 'Settings' }) })
      const firstSnapAssist = firstDialog.getByRole('checkbox', {
        name: 'Show snap assist when dragging to the top-center handle',
      })
      const secondSnapAssist = secondDialog.getByRole('checkbox', {
        name: 'Show snap assist when dragging to the top-center handle',
      })
      await firstSnapAssist.uncheck()
      await expect(secondSnapAssist).not.toBeChecked()

      const firstGap = firstDialog.getByRole('slider', { name: /Window gaps/ })
      const secondGap = secondDialog.getByRole('slider', { name: /Window gaps/ })
      await firstGap.fill('7')
      await expect(secondGap).toHaveValue('7')

      await secondPage.keyboard.press('Escape')
      const content = getBrowserContent(secondPage)
      await content.getByText('Documents', { exact: true }).click()
      await expect(content.getByText('readme.txt')).toBeVisible({ timeout: 10_000 })
      await content.getByText('readme.txt').click()
      await expect(getWindowGroups(secondPage)).toHaveCount(1)
      await expect(secondPage.locator('.workspace-tab-strip').getByText('readme.txt')).toBeVisible()
    } finally {
      await secondPage.close()
    }
  })
})
