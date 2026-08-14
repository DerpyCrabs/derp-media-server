import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import type { SettingsDto } from '@/lib/generated/api-contracts'
import { openBrowserWindow, getWindowGroups } from '../e2e/workspace-layout-helpers'
import { createWorkspaceE2EContext } from './workspace-e2e-context'

const batch = process.env.BATCH_ID ?? 'local'

let sharedContext: BrowserContext
let page: Page

async function savedPresetId(page: Page, name: string): Promise<string> {
  const response = await page.request.get('/api/settings')
  expect(response.ok()).toBeTruthy()
  const settings = (await response.json()) as SettingsDto
  const presetId = settings.workspaceLayoutPresets.find((preset) => preset.name === name)?.id
  expect(presetId).toBeTruthy()
  return presetId!
}

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
  test('save preset, layout dirty revert, hydrate via preset URL', async () => {
    const ws = `e2e-named-layout-${batch}-${Date.now()}`
    const presetName = `Batch ${batch} named layout`
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
    await page.getByPlaceholder('e.g. Review + browser').fill(presetName)
    const saveBtn = page
      .getByRole('dialog', { name: 'Save layout' })
      .getByRole('button', { name: 'Save', exact: true })
    await expect(saveBtn).toBeEnabled()
    await saveBtn.click()
    const saveResp = await respPromise
    expect(saveResp.ok()).toBeTruthy()
    await expect(page.getByRole('dialog', { name: 'Save layout' })).toBeHidden()
    const presetId = await savedPresetId(page, presetName)

    await expect(page).not.toHaveURL(/[?&]preset=/)

    await openBrowserWindow(page)
    await expect(getWindowGroups(page)).toHaveCount(2)

    await page.getByTestId('workspace-named-layout-trigger').click()
    await expect(page.getByRole('menuitem', { name: 'Revert to baseline' })).toBeVisible()
    await page.getByRole('menuitem', { name: 'Revert to baseline' }).click()
    await expect(getWindowGroups(page)).toHaveCount(1)

    const ws2 = `e2e-named-layout-2-${batch}-${Date.now()}`
    await page.goto(`/workspace?ws=${ws2}&preset=${presetId}`)
    await expect(getWindowGroups(page)).toHaveCount(1)
    await expect(page).not.toHaveURL(/[?&]preset=/)
  })

  test('update saved preset snapshot from current windows', async () => {
    const ws = `e2e-update-layout-${batch}-${Date.now()}`
    const presetName = `Update preset ${batch}`
    await page.goto(`/workspace?ws=${ws}`)
    await expect(getWindowGroups(page)).toHaveCount(1)

    await page.getByTestId('workspace-named-layout-trigger').click()
    await page.getByRole('menuitem', { name: 'Save current layout…' }).click()
    await page.getByPlaceholder('e.g. Review + browser').fill(presetName)
    await page
      .getByRole('dialog', { name: 'Save layout' })
      .getByRole('button', { name: 'Save' })
      .click()
    await expect(page.getByRole('dialog', { name: 'Save layout' })).toBeHidden()
    const presetId = await savedPresetId(page, presetName)

    await openBrowserWindow(page)
    await expect(getWindowGroups(page)).toHaveCount(2)

    await page.getByTestId('workspace-named-layout-trigger').click()
    const updateLabel = new RegExp(`Update layout.*${presetName}.*from current windows`)
    const [upd] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/api/settings/workspaceLayoutPresets') &&
          r.request().method() === 'POST',
      ),
      page
        .locator('[data-workspace-layout-menu]')
        .getByRole('button', { name: updateLabel })
        .click(),
    ])
    expect(upd.ok()).toBeTruthy()

    const ws2 = `e2e-update-layout-2-${batch}-${Date.now()}`
    await page.goto(`/workspace?ws=${ws2}&preset=${presetId}`)
    await expect(getWindowGroups(page)).toHaveCount(2)
    await expect(page).not.toHaveURL(/[?&]preset=/)
  })

  test('restores an image-folder reader from a named layout and after reload', async () => {
    const ws = `e2e-reader-layout-${batch}-${Date.now()}`
    const presetName = `Reader layout ${batch} ${Date.now()}`
    await page.goto(`/workspace?ws=${ws}`)
    await expect(getWindowGroups(page)).toHaveCount(1)

    const browser = getWindowGroups(page).first().locator('.workspace-window-content')
    await browser.getByText('Images', { exact: true }).click({ button: 'right' })
    await page.getByTestId('open-with-menu').click()
    await page.getByTestId('open-with-reader').click()
    await expect(getWindowGroups(page)).toHaveCount(2)

    const assertImageReader = async () => {
      const readerWindow = getWindowGroups(page).filter({
        has: page.getByTestId('reader-dialog'),
      })
      await expect(readerWindow).toHaveCount(1)
      await expect(readerWindow.locator('svg.lucide-book-open').first()).toBeVisible()
      await expect(readerWindow.locator('svg.lucide-folder')).toHaveCount(0)
      await expect(readerWindow.getByTestId('reader-image-page')).toHaveCount(2)
      await expect(readerWindow.getByTestId('region-layer').first()).toHaveCSS(
        'pointer-events',
        'auto',
      )
      await expect(readerWindow.getByText('This file type cannot be previewed.')).toHaveCount(0)
    }
    await assertImageReader()

    await page.getByTestId('workspace-named-layout-trigger').click()
    await page.getByRole('menuitem', { name: /Save current layout/ }).click()
    await page.getByPlaceholder('e.g. Review + browser').fill(presetName)
    const saveResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/settings/workspaceLayoutPresets') &&
        response.request().method() === 'POST',
    )
    await page
      .getByRole('dialog', { name: 'Save layout' })
      .getByRole('button', { name: 'Save', exact: true })
      .click()
    const response = await saveResponse
    expect(response.ok()).toBeTruthy()
    const presetId = await savedPresetId(page, presetName)

    const restoredWorkspace = `e2e-reader-layout-restored-${batch}-${Date.now()}`
    await page.goto(`/workspace?ws=${restoredWorkspace}&preset=${presetId}`)
    await expect(getWindowGroups(page)).toHaveCount(2)
    await expect(page).not.toHaveURL(/[?&]preset=/)
    await assertImageReader()

    await page.reload()
    await expect(getWindowGroups(page)).toHaveCount(2)
    await assertImageReader()
  })
})
