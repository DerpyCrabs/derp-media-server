import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import {
  createTempFile,
  deleteFileViaContextMenu,
  dragToEdge,
  getDragHandle,
  getVisibleContent,
  getWindowGroups,
  gotoWorkspace as gotoWorkspaceDnd,
  html5DragDrop,
  navigateToMediaContent,
  openBrowserWindow,
} from '../e2e/workspace-cross-dnd-helpers'
import { WORKSPACE_VISIBLE_WINDOW_GROUP } from './workspace-layout-helpers'
import { createWorkspaceE2EContext } from './workspace-e2e-context'

let browserContext: BrowserContext
let page: Page

test.beforeAll(async ({ browser }) => {
  browserContext = await createWorkspaceE2EContext(browser)
})

test.afterAll(async () => {
  await browserContext.close()
})

test.beforeEach(async () => {
  page = await browserContext.newPage()
  await clearTaskbarPins(page)
})

test.afterEach(async () => {
  await clearTaskbarPins(page)
  await page.close()
})

async function clearTaskbarPins(page: Page) {
  const settings = await page.request.get('/api/settings').then((response) => response.json())
  for (const pin of settings.workspaceTaskbarPins ?? []) {
    const response = await page.request.post('/api/settings/workspaceTaskbarPins/remove', {
      data: { id: pin.id },
    })
    expect(response.ok()).toBe(true)
  }
}

async function setTaskbarPins(page: Page, pins: unknown[]) {
  await clearTaskbarPins(page)
  for (const pin of pins) {
    const response = await page.request.post('/api/settings/workspaceTaskbarPins/add', {
      data: { pin },
    })
    expect(response.ok()).toBe(true)
  }
}

async function gotoWorkspace(page: Page) {
  await page.goto(`/workspace?ws=e2e-${crypto.randomUUID()}`)
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
    await expect(viewerContent.getByText('readme', { exact: false })).toBeVisible({
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

  test('concurrent pin adds in two tabs survive reversed responses', async () => {
    await clearTaskbarPins(page)
    const secondPage = await browserContext.newPage()
    let releaseFirstResponse = () => {}
    const firstResponseGate = new Promise<void>((resolve) => {
      releaseFirstResponse = resolve
    })
    let markFirstProcessed = () => {}
    const firstProcessed = new Promise<void>((resolve) => {
      markFirstProcessed = resolve
    })

    try {
      await Promise.all([gotoWorkspace(page), gotoWorkspace(secondPage)])
      await page.route('**/api/settings/workspaceTaskbarPins/add', async (route) => {
        const response = await route.fetch()
        markFirstProcessed()
        await firstResponseGate
        await route.fulfill({ response })
      })

      const firstContent = getBrowserContent(page)
      const secondContent = getBrowserContent(secondPage)
      await Promise.all([
        firstContent.getByText('Documents', { exact: true }).click(),
        secondContent.getByText('Documents', { exact: true }).click(),
      ])
      await Promise.all([
        expect(firstContent.getByText('readme.txt')).toBeVisible(),
        expect(secondContent.getByText('unsupported.xyz')).toBeVisible(),
      ])

      const delayedResponse = page.waitForResponse((response) =>
        response.url().endsWith('/api/settings/workspaceTaskbarPins/add'),
      )
      await firstContent
        .locator('table tr')
        .filter({ hasText: 'readme.txt' })
        .click({ button: 'right' })
      await page.locator('[data-slot="context-menu-item"]').getByText('Add to taskbar').click()
      await firstProcessed

      const secondResponse = secondPage.waitForResponse((response) =>
        response.url().endsWith('/api/settings/workspaceTaskbarPins/add'),
      )
      await secondContent
        .locator('table tr')
        .filter({ hasText: 'unsupported.xyz' })
        .click({ button: 'right' })
      await secondPage
        .locator('[data-slot="context-menu-item"]')
        .getByText('Add to taskbar')
        .click()
      await secondResponse

      releaseFirstResponse()
      await delayedResponse
      await expect(page.locator('[title="File: Documents/readme.txt"]')).toBeVisible()
      await expect(page.locator('[title="File: Documents/unsupported.xyz"]')).toBeVisible()
      await expect(secondPage.locator('[title="File: Documents/readme.txt"]')).toBeVisible()
      await expect(secondPage.locator('[title="File: Documents/unsupported.xyz"]')).toBeVisible()

      await expect
        .poll(async () => {
          const settings = await page.request
            .get('/api/settings')
            .then((response) => response.json())
          return settings.workspaceTaskbarPins.map((pin: { path: string }) => pin.path).sort()
        })
        .toEqual(['Documents/readme.txt', 'Documents/unsupported.xyz'])
    } finally {
      releaseFirstResponse()
      await page.unroute('**/api/settings/workspaceTaskbarPins/add')
      await secondPage.close()
      await clearTaskbarPins(page)
    }
  })

  test('concurrent remove and add compose when remove response arrives last', async () => {
    await setTaskbarPins(page, [
      {
        id: 'remove-race-existing',
        path: 'Documents/readme.txt',
        isDirectory: false,
        title: 'readme.txt',
        source: { kind: 'local' },
      },
    ])
    const secondPage = await browserContext.newPage()
    let releaseRemoveResponse = () => {}
    const removeResponseGate = new Promise<void>((resolve) => {
      releaseRemoveResponse = resolve
    })
    let markRemoveProcessed = () => {}
    const removeProcessed = new Promise<void>((resolve) => {
      markRemoveProcessed = resolve
    })

    try {
      await Promise.all([gotoWorkspace(page), gotoWorkspace(secondPage)])
      await page.route('**/api/settings/workspaceTaskbarPins/remove', async (route) => {
        const response = await route.fetch()
        markRemoveProcessed()
        await removeResponseGate
        await route.fulfill({ response })
      })

      const delayedRemove = page.waitForResponse((response) =>
        response.url().endsWith('/api/settings/workspaceTaskbarPins/remove'),
      )
      await page.locator('[title="File: Documents/readme.txt"]').click({ button: 'right' })
      await page.locator('[data-slot="context-menu-item"]').getByText('Unpin').click()
      await removeProcessed

      const content = getBrowserContent(secondPage)
      await content.getByText('Documents', { exact: true }).click()
      await expect(content.getByText('unsupported.xyz')).toBeVisible()
      const added = secondPage.waitForResponse((response) =>
        response.url().endsWith('/api/settings/workspaceTaskbarPins/add'),
      )
      await content
        .locator('table tr')
        .filter({ hasText: 'unsupported.xyz' })
        .click({ button: 'right' })
      await secondPage
        .locator('[data-slot="context-menu-item"]')
        .getByText('Add to taskbar')
        .click()
      await added

      releaseRemoveResponse()
      await delayedRemove
      await expect(page.locator('[title="File: Documents/readme.txt"]')).not.toBeVisible()
      await expect(page.locator('[title="File: Documents/unsupported.xyz"]')).toBeVisible()
      await expect(secondPage.locator('[title="File: Documents/readme.txt"]')).not.toBeVisible()
      await expect(secondPage.locator('[title="File: Documents/unsupported.xyz"]')).toBeVisible()
    } finally {
      releaseRemoveResponse()
      await page.unroute('**/api/settings/workspaceTaskbarPins/remove')
      await secondPage.close()
      await clearTaskbarPins(page)
    }
  })

  test('a late failed add cannot roll back another tab successful add', async () => {
    await clearTaskbarPins(page)
    const secondPage = await browserContext.newPage()
    let releaseFailure = () => {}
    const failureGate = new Promise<void>((resolve) => {
      releaseFailure = resolve
    })
    let markFailedRequestCaptured = () => {}
    const failedRequestCaptured = new Promise<void>((resolve) => {
      markFailedRequestCaptured = resolve
    })

    try {
      await Promise.all([gotoWorkspace(page), gotoWorkspace(secondPage)])
      await page.route('**/api/settings/workspaceTaskbarPins/add', async (route) => {
        markFailedRequestCaptured()
        await failureGate
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"error":"Injected pin failure"}',
        })
      })

      const firstContent = getBrowserContent(page)
      const secondContent = getBrowserContent(secondPage)
      await Promise.all([
        firstContent.getByText('Documents', { exact: true }).click(),
        secondContent.getByText('Documents', { exact: true }).click(),
      ])
      await firstContent
        .locator('table tr')
        .filter({ hasText: 'readme.txt' })
        .click({ button: 'right' })
      await page.locator('[data-slot="context-menu-item"]').getByText('Add to taskbar').click()
      await failedRequestCaptured

      const successfulAdd = secondPage.waitForResponse((response) =>
        response.url().endsWith('/api/settings/workspaceTaskbarPins/add'),
      )
      await secondContent
        .locator('table tr')
        .filter({ hasText: 'unsupported.xyz' })
        .click({ button: 'right' })
      await secondPage
        .locator('[data-slot="context-menu-item"]')
        .getByText('Add to taskbar')
        .click()
      await successfulAdd

      const failedAdd = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/settings/workspaceTaskbarPins/add') &&
          response.status() === 503,
      )
      releaseFailure()
      await failedAdd
      await expect(page.locator('[title="File: Documents/readme.txt"]')).not.toBeVisible()
      await expect(page.locator('[title="File: Documents/unsupported.xyz"]')).toBeVisible()
      await expect(secondPage.locator('[title="File: Documents/unsupported.xyz"]')).toBeVisible()
    } finally {
      releaseFailure()
      await page.unroute('**/api/settings/workspaceTaskbarPins/add')
      await secondPage.close()
      await clearTaskbarPins(page)
    }
  })

  test('dragging pinned file to folder in another browser moves the file', async () => {
    await gotoWorkspaceDnd(page)
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
