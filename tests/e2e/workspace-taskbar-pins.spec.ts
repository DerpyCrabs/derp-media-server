import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import {
  createTempFile,
  deleteFileViaContextMenu,
  dragToEdge,
  getDragHandle,
  getVisibleContent,
  getWindowGroups,
  html5DragDrop,
  navigateToMediaContent,
  openBrowserWindow,
} from '../e2e/workspace-cross-dnd-helpers'
import { WORKSPACE_VISIBLE_WINDOW_GROUP } from './workspace-layout-helpers'
import { createWorkspaceE2EContext } from './workspace-e2e-context'

let browserContext: BrowserContext
let page: Page
let workspacePath: string

test.beforeAll(async ({ browser }) => {
  browserContext = await createWorkspaceE2EContext(browser)
})

test.afterAll(async () => {
  await browserContext.close()
})

test.beforeEach(async ({}, testInfo) => {
  page = await browserContext.newPage()
  const slug = testInfo.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  workspacePath = `/workspace?ws=taskbar-pins-${slug}`
})

test.afterEach(async () => {
  await page.close()
})

async function gotoWorkspace(page: Page) {
  await page.goto(workspacePath)
  await expect(page.locator(WORKSPACE_VISIBLE_WINDOW_GROUP).first()).toBeVisible()
}

function getBrowserContent(page: Page) {
  return getWindowGroups(page).first().locator('.workspace-window-content')
}

test.describe('Workspace taskbar pins', () => {
  test('Add to taskbar from context menu adds pinned icon', async () => {
    await gotoWorkspace(page)
    const content = getBrowserContent(page)
    await expect(content.getByText('Documents', { exact: true })).toBeVisible()
    await content
      .locator('table tr')
      .filter({ hasText: 'Documents' })
      .first()
      .click({ button: 'right' })
    await page.locator('[data-slot="context-menu-item"]').getByText('Add to taskbar').click()

    await expect(page.locator('[title="Folder: Documents"]')).toBeVisible()
    await expect(
      page.locator('[data-taskbar-pin]').locator('[title="Folder: Documents"] svg.text-blue-500'),
    ).toBeVisible()
  })

  test('clicking pinned folder icon opens browser at that folder', async () => {
    await gotoWorkspace(page)
    const content = getBrowserContent(page)
    await content
      .locator('table tr')
      .filter({ hasText: 'Documents' })
      .first()
      .click({ button: 'right' })
    await page.locator('[data-slot="context-menu-item"]').getByText('Add to taskbar').click()

    await expect(page.locator('[title="Folder: Documents"]')).toBeVisible()
    await page.locator('[title="Folder: Documents"]').click()

    await expect(getWindowGroups(page)).toHaveCount(2)
    const secondContent = getWindowGroups(page).nth(1).locator('.workspace-window-content')
    await expect(secondContent.getByText('readme.txt')).toBeVisible()
  })

  test('Unpin from context menu removes pinned icon', async () => {
    await gotoWorkspace(page)
    const content = getBrowserContent(page)
    await content
      .locator('table tr')
      .filter({ hasText: 'Documents' })
      .first()
      .click({ button: 'right' })
    await page.locator('[data-slot="context-menu-item"]').getByText('Add to taskbar').click()

    await expect(page.locator('[title="Folder: Documents"]')).toBeVisible()
    await page.locator('[title="Folder: Documents"]').click({ button: 'right' })
    await page.locator('[data-slot="context-menu-item"]').getByText('Unpin').click()

    await expect(page.locator('[title="Folder: Documents"]')).not.toBeVisible()
  })

  test('clicking pinned file icon opens viewer for that file', async () => {
    await gotoWorkspace(page)
    const content = getBrowserContent(page)
    await content.getByText('Documents', { exact: true }).click()
    await expect(content.getByText('readme.txt')).toBeVisible()
    await content.locator('table tr').filter({ hasText: 'readme.txt' }).click({ button: 'right' })
    await page.locator('[data-slot="context-menu-item"]').getByText('Add to taskbar').click()

    await expect(page.locator('[title="File: Documents/readme.txt"]')).toBeVisible()
    await page.locator('[title="File: Documents/readme.txt"]').click()

    await expect(getWindowGroups(page)).toHaveCount(2)
    const viewerContent = getWindowGroups(page).nth(1).locator('.workspace-window-content')
    await expect(viewerContent.getByRole('heading', { name: 'readme.txt' })).toBeVisible({
      timeout: 5_000,
    })
  })

  test('clicking pinned unsupported file shows unsupported file viewer', async () => {
    await gotoWorkspace(page)
    const content = getBrowserContent(page)
    await content.getByText('Documents', { exact: true }).click()
    await expect(content.getByText('unsupported.xyz')).toBeVisible()
    await content
      .locator('table tr')
      .filter({ hasText: 'unsupported.xyz' })
      .click({ button: 'right' })
    await page.locator('[data-slot="context-menu-item"]').getByText('Add to taskbar').click()

    await expect(page.locator('[title="File: Documents/unsupported.xyz"]')).toBeVisible()
    await page.locator('[title="File: Documents/unsupported.xyz"]').click()

    await expect(getWindowGroups(page)).toHaveCount(2)
    const viewerContent = getWindowGroups(page).nth(1).locator('.workspace-window-content')
    await expect(viewerContent.getByText('This file type cannot be previewed.')).toBeVisible({
      timeout: 5_000,
    })
    await expect(viewerContent.getByRole('link', { name: 'Download File' })).toBeVisible()
  })

  test('admin workspace: pins persist in settings after reload', async () => {
    await gotoWorkspace(page)
    const content = getBrowserContent(page)
    const savePinned = page.waitForResponse(
      (resp) =>
        resp.request().method() === 'POST' &&
        resp.url().includes('/api/settings/workspaceTaskbarPins'),
    )
    await expect(content.getByText('Documents', { exact: true })).toBeVisible()
    await content
      .locator('table tr')
      .filter({ hasText: 'Documents' })
      .first()
      .click({ button: 'right' })
    await page.locator('[data-slot="context-menu-item"]').getByText('Add to taskbar').click()
    await expect(page.locator('[title="Folder: Documents"]')).toBeVisible()
    await savePinned

    await page.reload()
    await expect(page.locator(WORKSPACE_VISIBLE_WINDOW_GROUP).first()).toBeVisible()
    await expect(page.locator('[title="Folder: Documents"]')).toBeVisible()
  })

  test('unavailable provider pin inspection never suspends the Workspace', async () => {
    const pin = {
      id: 'pending-hermes-session',
      resource: { provider: 'hermes', id: 'v1:7:sessionsession-unavailable' },
      title: 'Unavailable Hermes session',
    }
    const seeded = await page.request.post('/api/settings/workspaceTaskbarPins', {
      data: { items: [pin] },
    })
    expect(seeded.ok()).toBe(true)

    let releaseInspect!: () => void
    const inspectGate = new Promise<void>((resolve) => {
      releaseInspect = resolve
    })
    let inspectStarted = 0
    let inspectFinished = false
    await page.route('**/api/integrations/hermes/inspect?*', async (route) => {
      inspectStarted += 1
      await inspectGate
      await route
        .fulfill({
          status: 503,
          json: { code: 'unavailable', message: 'Hermes gateway is unavailable' },
        })
        .catch(() => {})
      inspectFinished = true
    })

    try {
      await page.goto(workspacePath)
      await expect.poll(() => inspectStarted).toBe(1)
      await expect(page.locator(WORKSPACE_VISIBLE_WINDOW_GROUP).first()).toBeVisible()
      await expect(page.getByTitle('File: Unavailable Hermes session')).toBeVisible()

      releaseInspect()
      await expect.poll(() => inspectFinished).toBe(true)
      await expect(page.locator(WORKSPACE_VISIBLE_WINDOW_GROUP).first()).toBeVisible()
      await expect(page.getByTitle('File: Unavailable Hermes session')).toBeVisible()
    } finally {
      releaseInspect()
      await page.request.post('/api/settings/workspaceTaskbarPins', { data: { items: [] } })
    }
  })

  test('dragging pinned file to folder in another browser moves the file', async () => {
    await page.goto(workspacePath)
    await expect(getWindowGroups(page).first()).toBeVisible()
    await openBrowserWindow(page)

    const groups = getWindowGroups(page)
    await dragToEdge(page, getDragHandle(groups.first()), 'left')
    await groups.nth(1).dispatchEvent('mousedown')
    await page.waitForTimeout(30)
    await dragToEdge(page, getDragHandle(groups.nth(1)), 'right')

    const contentA = getVisibleContent(groups.first())
    const contentB = getVisibleContent(groups.nth(1))

    await navigateToMediaContent(contentA)
    await navigateToMediaContent(contentB)

    const tempFile = 'pin-cross-dnd-test.txt'
    await createTempFile(page, contentA, tempFile)

    const fileRow = contentA.locator('tr').filter({ hasText: tempFile })
    await fileRow.dispatchEvent('contextmenu')
    await page.locator('[data-slot="context-menu-item"]').getByText('Add to taskbar').click()

    const pinTitle = `File: MediaContent/${tempFile}`
    const pinSource = page
      .locator('[data-taskbar-pin]')
      .filter({ has: page.locator(`[title="${pinTitle}"]`) })

    const targetRow = contentB.locator('tr').filter({ hasText: 'subfolder' }).first()
    await html5DragDrop(pinSource, targetRow)

    await expect(contentA.getByText(tempFile)).not.toBeVisible({ timeout: 5_000 })

    await contentB.getByText('subfolder').first().click()
    await expect(contentB.getByText(tempFile)).toBeVisible({ timeout: 5_000 })

    await deleteFileViaContextMenu(page, contentB, tempFile)
  })
})
