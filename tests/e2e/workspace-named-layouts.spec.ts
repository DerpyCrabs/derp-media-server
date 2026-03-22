import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { openBrowserWindow, getWindowGroups } from '../e2e/workspace-layout-helpers'
import { createWorkspaceE2EContext } from './workspace-e2e-auth'

const batch = process.env.BATCH_ID ?? 'local'

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

test.describe('workspace named layout presets', () => {
  test('save preset, dirty badge, revert, hydrate via preset URL', async () => {
    const ws = `e2e-named-layout-${batch}-${Date.now()}`
    await page.goto(`/workspace?ws=${ws}`)
    await expect(page.getByTestId('workspace-named-layout-trigger')).toBeEnabled()
    await expect(getWindowGroups(page)).toHaveCount(1)

    await page.getByTestId('workspace-named-layout-trigger').click()
    await page.getByRole('menuitem', { name: 'Save current layout…' }).click()
    await expect(page.getByRole('dialog', { name: 'Save layout' })).toBeVisible()

    const respPromise = page.waitForResponse(
      (r) =>
        r.url().includes('/api/settings/workspaceLayoutPresets') && r.request().method() === 'POST',
    )
    await page.getByPlaceholder('e.g. Review + browser').fill(`Batch ${batch} named layout`)
    const saveBtn = page
      .getByRole('dialog', { name: 'Save layout' })
      .getByRole('button', { name: 'Save', exact: true })
    await expect(saveBtn).toBeEnabled()
    await saveBtn.click()
    const saveResp = await respPromise
    expect(saveResp.ok()).toBeTruthy()
    const saveBody = (await saveResp.json()) as { workspaceLayoutPresets: { id: string }[] }
    const presetId = saveBody.workspaceLayoutPresets.at(-1)?.id
    expect(presetId).toBeTruthy()

    await expect(page).not.toHaveURL(/[?&]preset=/)

    await openBrowserWindow(page)
    await expect(getWindowGroups(page)).toHaveCount(2)
    await expect(page.getByTestId('workspace-layout-modified-badge')).toBeVisible()

    await page.getByTestId('workspace-named-layout-trigger').click()
    await page.getByRole('menuitem', { name: 'Revert to baseline' }).click()
    await expect(getWindowGroups(page)).toHaveCount(1)

    const ws2 = `e2e-named-layout-2-${batch}-${Date.now()}`
    await page.goto(`/workspace?ws=${ws2}&preset=${presetId}`)
    await expect(getWindowGroups(page)).toHaveCount(1)
    await expect(page).not.toHaveURL(/[?&]preset=/)
  })
})
