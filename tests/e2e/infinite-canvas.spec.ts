import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { dispatchRecordedPointerCancel, recordNextPointerId } from './workspace-layout-helpers'

const CLIENT_ID = 'playwright-canvas-workspace'

function canvasSnapshot(windows: any[] = []) {
  return {
    workspaceType: 'canvas',
    windows,
    activeWindowId: windows.at(-1)?.id ?? null,
    activeTabMap: {},
    nextWindowId: windows.length + 1,
    canvas: {
      camera: { x: 0, y: 0, zoom: 1 },
      maximizedWindowId: null,
      windowSizeByType: {},
      nextZIndex: windows.length + 1,
    },
  }
}

async function createCanvasWorkspace(
  request: APIRequestContext,
  id: string,
  snapshot = canvasSnapshot(),
) {
  const response = await request.post('/api/workspaces/open', {
    data: { id, clientId: CLIENT_ID, snapshot },
  })
  expect(response.ok()).toBe(true)
}

async function replaceCanvasWorkspace(
  request: APIRequestContext,
  id: string,
  snapshot: ReturnType<typeof canvasSnapshot>,
) {
  const opened = await request.post('/api/workspaces/open', {
    data: { id, clientId: CLIENT_ID, takeover: true },
  })
  const record = (await opened.json()).record
  const saved = await request.post('/api/workspaces/save', {
    data: { id, clientId: CLIENT_ID, revision: record.revision, snapshot },
  })
  expect(saved.ok()).toBe(true)
}

async function nameWorkspace(request: APIRequestContext, id: string, name: string) {
  const registry = await request
    .get(`/api/workspaces?clientId=${encodeURIComponent(CLIENT_ID)}`)
    .then((response) => response.json())
  const record = registry.records[id]
  const saved = await request.post('/api/workspaces/save', {
    data: {
      id,
      clientId: CLIENT_ID,
      revision: record.revision,
      snapshot: record.snapshot,
      metadata: { name, icon: null, iconColor: null },
    },
  })
  expect(saved.ok()).toBe(true)
}

async function expectWorkspaceWindowCount(request: APIRequestContext, id: string, count: number) {
  await expect
    .poll(async () => {
      const response = await request.get(
        `/api/workspaces?clientId=${encodeURIComponent(CLIENT_ID)}`,
      )
      expect(response.ok()).toBe(true)
      const registry = await response.json()
      return registry.records[id]?.snapshot.windows.length
    })
    .toBe(count)
}

async function dragFirstCanvasWindowToWorkspace(page: Page, destinationName: string) {
  const titlebar = page.getByTestId('canvas-window-titlebar').first()
  const titlebarBox = await titlebar.boundingBox()
  await page.mouse.move(titlebarBox!.x + 100, titlebarBox!.y + titlebarBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(5, 160, { steps: 12 })
  const panel = page.getByTestId('workspace-switcher')
  await expect(panel).toBeVisible()
  const target = panel.getByText(destinationName, { exact: true })
  await target.scrollIntoViewIfNeeded()
  const targetBox = await target.boundingBox()
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2)
  const row = target.locator('xpath=ancestor::*[@data-workspace-id][1]')
  await expect(row).toContainText('Hold to move here')
  await page.waitForTimeout(1_100)
  await expect(row).toContainText('Release to move here')
  await page.mouse.up()
}

async function pinnedPath(pin: Locator) {
  return pin.evaluate((element) => {
    const dataTransfer = new DataTransfer()
    element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }))
    return dataTransfer.getData('text/plain')
  })
}

async function replaceTaskbarPins(request: APIRequestContext, items: unknown[]) {
  const settings = await request.get('/api/settings').then((response) => response.json())
  for (const pin of settings.workspaceTaskbarPins ?? []) {
    const response = await request.post('/api/settings/workspaceTaskbarPins/remove', {
      data: { id: pin.id },
    })
    expect(response.ok()).toBe(true)
  }
  for (const pin of items) {
    const response = await request.post('/api/settings/workspaceTaskbarPins/add', {
      data: { pin },
    })
    expect(response.ok()).toBe(true)
  }
}

async function addFileBrowser(page: Page) {
  if ((await page.getByTestId('canvas-window').count()) === 0) {
    await page.getByRole('button', { name: 'Browse files' }).click()
    return
  }
  await page.getByTestId('infinite-canvas').click({ button: 'right', position: { x: 8, y: 8 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()
}

test.beforeEach(async ({ page, request }, testInfo) => {
  const id = `canvas-${testInfo.workerIndex}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  await replaceTaskbarPins(request, [])
  await createCanvasWorkspace(request, id)
  await page.addInitScript((clientId) => {
    sessionStorage.setItem('workspace-client-id', clientId)
  }, CLIENT_ID)
  await page.goto(`/workspace?ws=${encodeURIComponent(id)}`)
  await expect(page.getByTestId('infinite-canvas')).toBeVisible()
})

test('uses unified compact taskbar without canvas window rows', async ({ page }) => {
  await expect(page.getByText('Canvas workspace', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Open workspaces' })).toBeVisible()
  await expect(page.getByTitle('Canvas outline')).toBeVisible()
  await expect(page.getByTestId('canvas-search-trigger')).toBeVisible()
  await expect(page.getByTitle('Fit all canvas cards')).toBeVisible()
  await expect(page.locator('[data-taskbar-window-row]')).toHaveCount(0)
})

test('opens workspace list only from click during ordinary pointer use', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'Open workspaces' })
  const panel = page.getByTestId('workspace-switcher')

  await trigger.hover()
  await page.mouse.move(1, 360)
  await page.waitForTimeout(500)
  await expect(panel).toBeHidden()

  await trigger.click()
  await expect(panel).toBeVisible()
})

test('refreshes lock icons when opening the workspace list', async ({ page, request }) => {
  const destinationId = `canvas-locked-${Date.now()}`
  await createCanvasWorkspace(request, destinationId)
  const released = await request.post('/api/workspaces/release', {
    data: { id: destinationId, clientId: CLIENT_ID },
  })
  expect(released.ok()).toBe(true)

  const owner = await page.context().newPage()
  await owner.addInitScript(() => {
    sessionStorage.setItem('workspace-client-id', 'canvas-owner-tab')
  })
  await owner.goto(`/workspace?ws=${encodeURIComponent(destinationId)}`)
  await expect(owner.getByTestId('infinite-canvas')).toBeVisible()

  let registryReads = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/workspaces') registryReads += 1
  })
  const readsBeforeOpen = registryReads
  await page.getByRole('button', { name: 'Open workspaces' }).click()
  await expect.poll(() => registryReads).toBeGreaterThan(readsBeforeOpen)
  const row = page
    .getByTestId('workspace-switcher')
    .locator(`[data-workspace-id="${destinationId}"]`)
  await expect(row.locator('.lucide-lock')).toBeVisible()
  await expect(row).toContainText('Open in another tab')
})

test('resets canvas-local UI when switching between canvas workspaces', async ({
  page,
  request,
}) => {
  const sourceId = new URL(page.url()).searchParams.get('ws')!
  const destinationId = `canvas-switch-${Date.now()}`
  await createCanvasWorkspace(request, destinationId)

  await page.getByTitle('Canvas outline').click()
  await expect(page.getByRole('button', { name: 'Close canvas outline' })).toBeVisible()
  await page.getByRole('button', { name: 'Open workspaces' }).click()
  await page
    .getByTestId('workspace-switcher')
    .locator(`[data-workspace-id="${destinationId}"]`)
    .click()

  await expect(page).not.toHaveURL(new RegExp(`ws=${sourceId}(?:&|$)`))
  await expect(page).toHaveURL(new RegExp(`ws=${destinationId}(?:&|$)`))
  await expect(page.getByTestId('infinite-canvas')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close canvas outline' })).toBeHidden()
})

test('persists canvas cards through workspace revisions', async ({ page }) => {
  const id = new URL(page.url()).searchParams.get('ws')!
  await addFileBrowser(page)
  await expect(page.getByTestId('canvas-window')).toHaveCount(1)
  await expectWorkspaceWindowCount(page.request, id, 1)
  await page.reload()
  await expect(page.getByTestId('canvas-window')).toHaveCount(1)
})

test('keeps save failure recovery inside the canvas taskbar', async ({ page }) => {
  const id = new URL(page.url()).searchParams.get('ws')!
  await page.route('**/api/workspaces/save', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Offline"}' }),
  )
  await addFileBrowser(page)

  const error = page.getByTestId('workspace-save-error')
  await expect(error).toContainText('Offline')
  await expect(error.getByRole('button', { name: 'Retry' })).toBeVisible()
  const bounds = await error.boundingBox()
  expect(bounds!.y).toBeGreaterThan(page.viewportSize()!.height - 40)

  await page.unroute('**/api/workspaces/save')
  await error.getByRole('button', { name: 'Retry' }).click()
  await expect(error).toHaveCount(0)
  await expectWorkspaceWindowCount(page.request, id, 1)
})

test('takes control and retries the pending canvas save after a stale lease', async ({ page }) => {
  const id = new URL(page.url()).searchParams.get('ws')!
  let rejected = false
  await page.route('**/api/workspaces/save', (route) => {
    if (rejected) return route.continue()
    rejected = true
    return route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: '{"error":"Workspace is open elsewhere"}',
    })
  })
  await addFileBrowser(page)

  const error = page.getByTestId('workspace-save-error')
  await expect(error).toContainText('Workspace is open elsewhere')
  await error.getByRole('button', { name: 'Take control' }).click()

  await expect(error).toHaveCount(0)
  await expect(page.getByTestId('canvas-window')).toHaveCount(1)
  await expectWorkspaceWindowCount(page.request, id, 1)
})

test('flushes the latest canvas edit before switching workspaces', async ({ page }) => {
  const sourceId = new URL(page.url()).searchParams.get('ws')!
  await addFileBrowser(page)
  await page.getByRole('button', { name: 'Open workspaces' }).click()
  await page.getByRole('button', { name: 'New workspace' }).click()
  await expect(page.locator('.workspace-layout')).toBeVisible()

  await page.getByRole('button', { name: 'Open workspaces' }).click()
  await page.getByTestId('workspace-switcher').locator(`[data-workspace-id="${sourceId}"]`).click()

  await expect(page.getByTestId('infinite-canvas')).toBeVisible()
  await expect(page.getByTestId('canvas-window')).toHaveCount(1)
})

test('converts the active workspace between canvas and desktop', async ({ page }) => {
  const workspaceId = new URL(page.url()).searchParams.get('ws')!
  await page.getByRole('button', { name: 'Open workspaces' }).click()
  await page.locator(`[data-workspace-id="${workspaceId}"]`).click({ button: 'right' })
  await page.getByRole('button', { name: 'Convert to desktop' }).click()
  const desktopConversion = page.waitForResponse('**/api/workspaces/convert')
  await page
    .getByRole('alertdialog', { name: 'Convert to desktop?' })
    .getByRole('button', { name: 'Convert' })
    .click()
  const desktopResponse = await desktopConversion
  if (!desktopResponse.ok()) {
    throw new Error(`${desktopResponse.status()}: ${await desktopResponse.text()}`)
  }

  await expect(page.locator('.workspace-layout')).toBeVisible()
  await page.getByRole('button', { name: 'Open workspaces' }).click()
  await page.locator(`[data-workspace-id="${workspaceId}"]`).click({ button: 'right' })
  await page.getByRole('button', { name: 'Convert to canvas' }).click()
  const canvasConversion = page.waitForResponse('**/api/workspaces/convert')
  await page
    .getByRole('alertdialog', { name: 'Convert to canvas?' })
    .getByRole('button', { name: 'Convert' })
    .click()
  const canvasResponse = await canvasConversion
  if (!canvasResponse.ok()) {
    throw new Error(`${canvasResponse.status()}: ${await canvasResponse.text()}`)
  }

  await expect(page.getByTestId('infinite-canvas')).toBeVisible()
})

test('keeps canvas keyboard shortcuts behind app confirmation', async ({ page }) => {
  await addFileBrowser(page)
  await expect(page.getByTestId('canvas-window')).toHaveCount(1)

  await page.getByRole('button', { name: 'Open workspaces' }).click()
  const id = new URL(page.url()).searchParams.get('ws')!
  await page.locator(`[data-workspace-id="${id}"]`).click({ button: 'right' })
  await page.getByRole('button', { name: 'Delete' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()

  await page.keyboard.press('Backspace')

  await expect(dialog).toBeVisible()
  await expect(page.getByTestId('canvas-window')).toHaveCount(1)
  await dialog.getByRole('button', { name: 'Cancel' }).click()
})

test('reuses the workspace library search palette', async ({ page }) => {
  await addFileBrowser(page)
  await page.keyboard.press('ControlOrMeta+p')
  const palette = page.getByTestId('file-search-palette')
  await expect(palette).toBeVisible()
  await expect(palette.getByPlaceholder('Search files and folders…')).toBeVisible()
})

test('renders grouped tabs as one card and summarizes them while zoomed out', async ({
  page,
  request,
}) => {
  const id = new URL(page.url()).searchParams.get('ws')!
  const windows = ['one', 'two'].map((windowId, index) => ({
    id: windowId,
    type: 'browser',
    title: index ? 'Second tab' : 'First tab',
    source: { kind: 'local' },
    initialState: {},
    tabGroupId: 'one',
    layout: { bounds: { x: 80, y: 80, width: 640, height: 480 }, zIndex: 1 },
  }))
  const opened = await request.post('/api/workspaces/open', {
    data: { id, clientId: CLIENT_ID, takeover: true },
  })
  const record = (await opened.json()).record
  await request.post('/api/workspaces/save', {
    data: {
      id,
      clientId: CLIENT_ID,
      revision: record.revision,
      snapshot: {
        ...canvasSnapshot(windows),
        activeWindowId: 'two',
        activeTabMap: { one: 'two' },
      },
    },
  })
  await page.reload()
  await expect(page.getByTestId('canvas-window')).toHaveCount(1)
  await expect(page.locator('[data-workspace-tab-id]')).toHaveCount(2)
  await page.getByRole('slider', { name: 'Canvas zoom' }).fill('20')
  await expect(page.getByTestId('canvas-window-summary')).toContainText('2 tabs')
})

test('activates and closes a canvas tab as one document transition', async ({ page, request }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const id = new URL(page.url()).searchParams.get('ws')!
  const windows = ['one', 'two'].map((windowId, index) => ({
    id: windowId,
    type: 'browser',
    title: index ? 'Second tab' : 'First tab',
    source: { kind: 'local' },
    initialState: { dir: index ? 'Documents' : '' },
    tabGroupId: 'one',
    layout: { bounds: { x: 80, y: 80, width: 640, height: 480 }, zIndex: 1 },
  }))
  await replaceCanvasWorkspace(request, id, {
    ...canvasSnapshot(windows),
    activeWindowId: 'two',
    activeTabMap: { one: 'two' },
  })
  await page.reload()

  const firstTab = page.locator('[data-workspace-tab-id="one"]')
  await firstTab.click()
  await expect(firstTab).toHaveClass(/bg-background/)
  await firstTab.getByTestId('workspace-tab-close').click()
  await expect(page.locator('[data-workspace-tab-id="one"]')).toHaveCount(0)
  await expect(page.locator('[data-workspace-tab-id="two"]')).toHaveClass(/bg-background/)
  await expect
    .poll(async () => {
      const registry = await request
        .get(`/api/workspaces?clientId=${encodeURIComponent(CLIENT_ID)}`)
        .then((response) => response.json())
      const snapshot = registry.records[id]?.snapshot
      return {
        ids: snapshot?.windows.map((window: { id: string }) => window.id),
        activeWindowId: snapshot?.activeWindowId,
      }
    })
    .toEqual({ ids: ['two'], activeWindowId: 'two' })
  expect(pageErrors).toEqual([])
})

test('canvas navigation, file viewing, and taskbar pins share desktop semantics', async ({
  page,
}) => {
  await addFileBrowser(page)
  const browser = page.locator('[data-canvas-window-content]').first()
  await expect(browser.getByText('Documents', { exact: true })).toBeVisible()

  const documents = browser.locator('table tr').filter({ hasText: 'Documents' }).first()
  await documents.click({ button: 'right' })
  await page.locator('[data-slot="context-menu-item"]').getByText('Add to taskbar').click()
  await expect(page.locator('[title="Folder: Documents"]')).toBeVisible()

  await browser.getByText('Documents', { exact: true }).click()
  await expect(browser.getByText('readme.txt', { exact: true })).toBeVisible()
  await expect(page.locator('[data-workspace-tab-id]').first()).toContainText('Documents')

  await browser.getByText('readme.txt', { exact: true }).click()
  await expect(page.getByTestId('canvas-window')).toHaveCount(2)
  await page.getByRole('slider', { name: 'Canvas zoom' }).fill('100')
  await expect(
    page.locator('[data-workspace-tab-id]').filter({ hasText: 'readme.txt' }),
  ).toBeVisible()
})

test('keeps zoom control in taskbar and hides it for maximized card', async ({ page }) => {
  await addFileBrowser(page)
  const zoom = page.getByTestId('canvas-zoom-control')
  await expect(page.locator('header').getByTestId('canvas-zoom-control')).toBeVisible()
  await page.getByTitle('Maximize').click()
  await expect(zoom).toHaveCount(0)
})

test('keeps window content mounted while dragging', async ({ page }) => {
  await addFileBrowser(page)
  const content = page.locator('[data-canvas-window-content] > div').first()
  await content.evaluate((element) => element.setAttribute('data-mount-marker', 'preserved'))
  const titlebar = page.getByTestId('canvas-window-titlebar').first()
  const box = await titlebar.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + 80, box!.y + 16)
  await page.mouse.down()
  await page.mouse.move(box!.x + 240, box!.y + 120, { steps: 8 })
  await page.mouse.up()
  await expect(page.locator('[data-canvas-window-content] > div').first()).toHaveAttribute(
    'data-mount-marker',
    'preserved',
  )
})

test('ordinary switcher hover cannot arm the next canvas drag for workspace transfer', async ({
  page,
  request,
}) => {
  const sourceId = new URL(page.url()).searchParams.get('ws')!
  await addFileBrowser(page)
  await expectWorkspaceWindowCount(request, sourceId, 1)
  const destinationId = `ordinary-hover-target-${Date.now()}`
  const opened = await request.post('/api/workspaces/open', {
    data: {
      id: destinationId,
      clientId: CLIENT_ID,
      snapshot: {
        workspaceType: 'desktop',
        windows: [],
        activeWindowId: null,
        activeTabMap: {},
        nextWindowId: 1,
      },
    },
  })
  expect(opened.ok()).toBe(true)
  await page.reload()

  await page.getByRole('button', { name: 'Open workspaces' }).click()
  const panel = page.getByTestId('workspace-switcher')
  const target = panel.locator(`[data-workspace-id="${destinationId}"]`)
  await target.hover()
  await page.waitForTimeout(1_100)
  await page.mouse.move(700, 400)
  await expect(panel).toBeHidden()

  const titlebar = page.getByTestId('canvas-window-titlebar')
  const box = await titlebar.boundingBox()
  await page.mouse.move(box!.x + 100, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + 220, box!.y + 120, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  await expect(page).toHaveURL(new RegExp(`ws=${sourceId}(?:&|$)`))
  await expect(page.getByTestId('canvas-window')).toHaveCount(1)
})

test('leaving a workspace row cancels canvas transfer dwell', async ({ page, request }) => {
  const sourceId = new URL(page.url()).searchParams.get('ws')!
  await addFileBrowser(page)
  await expect(page.getByTestId('canvas-window')).toHaveCount(1)
  await expectWorkspaceWindowCount(request, sourceId, 1)
  const destinationId = `cancelled-dwell-${Date.now()}`
  const opened = await request.post('/api/workspaces/open', {
    data: {
      id: destinationId,
      clientId: CLIENT_ID,
      snapshot: {
        workspaceType: 'desktop',
        windows: [],
        activeWindowId: null,
        activeTabMap: {},
        nextWindowId: 1,
      },
    },
  })
  expect(opened.ok()).toBe(true)
  await page.reload()

  const titlebarBox = await page.getByTestId('canvas-window-titlebar').boundingBox()
  await recordNextPointerId(page)
  await page.mouse.move(titlebarBox!.x + 100, titlebarBox!.y + titlebarBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(5, 160, { steps: 10 })
  const panel = page.getByTestId('workspace-switcher')
  const target = panel.locator(`[data-workspace-id="${destinationId}"]`)
  await expect(target).toBeVisible()
  const targetBox = await target.boundingBox()
  expect(targetBox).not.toBeNull()
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2)
  await page.waitForTimeout(250)
  const panelBox = await panel.boundingBox()
  await page.mouse.move(panelBox!.x + panelBox!.width - 3, panelBox!.y + 3)
  await page.waitForTimeout(1_100)
  await expect(target).not.toContainText('Release to move here')
  await page.mouse.up()

  await expect(page).toHaveURL(new RegExp(`ws=${sourceId}(?:&|$)`))
  await expect(page.getByTestId('canvas-window')).toHaveCount(1)
})

test('pointer cancellation never commits a ready canvas workspace transfer', async ({
  page,
  request,
}) => {
  const sourceId = new URL(page.url()).searchParams.get('ws')!
  await addFileBrowser(page)
  await expectWorkspaceWindowCount(request, sourceId, 1)
  const destinationId = `pointer-cancel-target-${Date.now()}`
  await request.post('/api/workspaces/open', {
    data: {
      id: destinationId,
      clientId: CLIENT_ID,
      snapshot: {
        workspaceType: 'desktop',
        windows: [],
        activeWindowId: null,
        activeTabMap: {},
        nextWindowId: 1,
      },
    },
  })
  await page.reload()
  const originalBox = await page.getByTestId('canvas-window').boundingBox()

  const titlebarBox = await page.getByTestId('canvas-window-titlebar').boundingBox()
  await recordNextPointerId(page)
  await page.mouse.move(titlebarBox!.x + 100, titlebarBox!.y + titlebarBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(5, 160, { steps: 10 })
  const target = page
    .getByTestId('workspace-switcher')
    .locator(`[data-workspace-id="${destinationId}"]`)
  await target.hover()
  await page.waitForTimeout(1_100)
  await expect(target).toContainText('Release to move here')
  await dispatchRecordedPointerCancel(page, { clientX: 5, clientY: 160 })
  await page.mouse.up()

  await expect(page).toHaveURL(new RegExp(`ws=${sourceId}(?:&|$)`))
  await expect(page.getByTestId('canvas-window')).toHaveCount(1)
  const restoredBox = await page.getByTestId('canvas-window').boundingBox()
  expect(restoredBox!.x).toBeCloseTo(originalBox!.x, 0)
  expect(restoredBox!.y).toBeCloseTo(originalBox!.y, 0)
})

test('uses desktop workspace titlebar and tab interactions', async ({ page }) => {
  await addFileBrowser(page)
  const card = page.getByTestId('canvas-window').first()
  await expect(card.locator('[data-workspace-tab-id]')).toHaveCount(1)
  await expect(card.getByTestId('workspace-tab-scroll-area')).toBeVisible()
  await card.locator('[data-workspace-tab-id]').click({ button: 'right' })
  await expect(page.getByRole('menu')).toBeVisible()
})

test('locked canvas is visibly read only and rejects tab mutations', async ({
  page,
  browser,
  request,
}) => {
  const id = new URL(page.url()).searchParams.get('ws')!
  await addFileBrowser(page)
  await expectWorkspaceWindowCount(request, id, 1)

  const duplicateContext = await browser.newContext()
  const duplicate = await duplicateContext.newPage()
  await duplicate.goto(page.url())
  await expect(duplicate.getByText('Read only — workspace is open elsewhere')).toBeVisible()
  await duplicate.locator('[data-workspace-tab-id]').click({ button: 'right' })
  await duplicate.getByRole('menuitem', { name: 'Pin tab' }).click()

  const registry = await request
    .get(`/api/workspaces?clientId=${encodeURIComponent(CLIENT_ID)}`)
    .then((response) => response.json())
  expect(registry.records[id].snapshot.windows[0].tabPinned).not.toBe(true)
  await duplicateContext.close()
})

test('merges cards by dragging one tab onto another tab bar', async ({ page, request }) => {
  const id = new URL(page.url()).searchParams.get('ws')!
  const windows = ['one', 'two'].map((windowId, index) => ({
    id: windowId,
    type: 'browser',
    title: `Browser ${index + 1}`,
    source: { kind: 'local' },
    initialState: {},
    tabGroupId: null,
    layout: {
      bounds: { x: 40 + index * 680, y: 80, width: 640, height: 480 },
      zIndex: index + 1,
    },
  }))
  await replaceCanvasWorkspace(request, id, canvasSnapshot(windows))
  await page.reload()
  const cards = page.getByTestId('canvas-window')
  await expect(cards).toHaveCount(2)
  const from = await cards.nth(1).getByTestId('canvas-window-titlebar').boundingBox()
  const to = await cards.nth(0).getByTestId('canvas-window-titlebar').boundingBox()
  expect(from).not.toBeNull()
  expect(to).not.toBeNull()
  await page.mouse.move(from!.x + from!.width - 90, from!.y + from!.height / 2)
  await page.mouse.down()
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 12 })
  await expect(cards.nth(1)).toHaveCSS('opacity', '0.55')
  await page.mouse.up()
  await expect(cards).toHaveCount(1)
  await expect(page.locator('[data-workspace-tab-id]')).toHaveCount(2)
})

test('places workspace button and pins before canvas zoom', async ({ page, request }) => {
  const id = new URL(page.url()).searchParams.get('ws')!
  const snapshot = canvasSnapshot()
  await replaceTaskbarPins(request, [
    {
      id: 'test-pin',
      title: 'Pinned folder',
      path: 'Content',
      isDirectory: true,
      source: { kind: 'local' },
      customIconName: null,
    },
  ])
  await replaceCanvasWorkspace(request, id, snapshot)
  await page.reload()
  const taskbar = page.locator('header')
  await expect(taskbar.getByTestId('canvas-zoom-control')).toBeVisible()
  const order = await taskbar
    .locator(
      '[data-testid="workspace-taskbar-workspaces"], [data-testid="workspace-taskbar-pin"], [data-testid="canvas-zoom-control"]',
    )
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-testid')))
  expect(order).toEqual([
    'workspace-taskbar-workspaces',
    'workspace-taskbar-pin',
    'canvas-zoom-control',
  ])
})

test('renaming a file updates its canvas card and pin through SSE', async ({ page, request }) => {
  const id = new URL(page.url()).searchParams.get('ws')!
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const oldName = `canvas-rename-old-${suffix}.md`
  const newName = `canvas-rename-new-${suffix}.md`
  const oldPath = `MediaContent/${oldName}`
  const newPath = `MediaContent/${newName}`
  const created = await request.post('/api/files/create', {
    data: { type: 'file', path: oldPath, content: '# Canvas rename\n' },
  })
  expect(created.ok()).toBe(true)

  try {
    const snapshot = canvasSnapshot([
      {
        id: 'rename-viewer',
        type: 'viewer',
        title: oldName,
        iconPath: oldPath,
        iconType: 'text',
        source: { kind: 'local' },
        initialState: { viewing: oldPath, dir: 'MediaContent' },
        tabGroupId: null,
        layout: { bounds: { x: 80, y: 80, width: 640, height: 480 }, zIndex: 1 },
      },
    ])
    snapshot.canvas.camera.zoom = 0.5
    await replaceTaskbarPins(request, [
      {
        id: 'rename-pin',
        title: oldName,
        path: oldPath,
        isDirectory: false,
        source: { kind: 'local' },
      },
    ])
    await replaceCanvasWorkspace(request, id, snapshot)
    await page.reload()

    const card = page.getByTestId('canvas-window')
    await expect(card).toHaveCount(1)
    await expect(card.getByTestId('canvas-window-zoom-path')).toHaveText(oldPath)
    const pin = page.getByTestId('workspace-taskbar-pin')
    await expect(pin).toHaveCount(1)
    await expect.poll(() => pinnedPath(pin)).toBe(oldPath)

    const mutationStartedAt = Date.now()
    const renamed = await request.post('/api/files/rename', {
      data: { oldPath, newPath },
    })
    expect(renamed.ok()).toBe(true)

    await expect
      .poll(() => card.getByTestId('canvas-window-zoom-path').textContent(), {
        timeout: 2_800,
        intervals: [50, 100, 200],
      })
      .toBe(newPath)
    expect(Date.now() - mutationStartedAt).toBeLessThan(3_000)
    await expect
      .poll(() => pinnedPath(pin), { timeout: 2_800, intervals: [50, 100, 200] })
      .toBe(newPath)

    await addFileBrowser(page)
    await expect(page.getByTestId('canvas-window')).toHaveCount(2)
    await expect
      .poll(
        async () => {
          const registry = await request.get('/api/workspaces').then((response) => response.json())
          return registry.records[id]?.snapshot.windows.length ?? 0
        },
        { timeout: 5_000, intervals: [50, 100, 200] },
      )
      .toBe(2)
  } finally {
    await replaceTaskbarPins(request, [])
    await request.post('/api/files/delete', { data: { path: newPath } })
    await request.post('/api/files/delete', { data: { path: oldPath } })
  }
})

test('deleting a file removes its canvas card and pin through SSE', async ({ page, request }) => {
  const id = new URL(page.url()).searchParams.get('ws')!
  const fileName = `canvas-delete-${Date.now()}-${Math.random().toString(36).slice(2)}.md`
  const filePath = `MediaContent/${fileName}`
  const created = await request.post('/api/files/create', {
    data: { type: 'file', path: filePath, content: '# Canvas delete\n' },
  })
  expect(created.ok()).toBe(true)

  try {
    const snapshot = canvasSnapshot([
      {
        id: 'delete-viewer',
        type: 'viewer',
        title: fileName,
        iconPath: filePath,
        iconType: 'text',
        source: { kind: 'local' },
        initialState: { viewing: filePath, dir: 'MediaContent' },
        tabGroupId: null,
        layout: { bounds: { x: 80, y: 80, width: 640, height: 480 }, zIndex: 1 },
      },
    ])
    snapshot.canvas.camera.zoom = 0.5
    await replaceTaskbarPins(request, [
      {
        id: 'delete-pin',
        title: fileName,
        path: filePath,
        isDirectory: false,
        source: { kind: 'local' },
      },
    ])
    await replaceCanvasWorkspace(request, id, snapshot)
    await page.reload()

    await expect(page.getByTestId('canvas-window')).toHaveCount(1)
    await expect(page.getByTestId('workspace-taskbar-pin')).toHaveCount(1)

    const mutationStartedAt = Date.now()
    const deleted = await request.post('/api/files/delete', { data: { path: filePath } })
    expect(deleted.ok()).toBe(true)

    await expect
      .poll(() => page.getByTestId('canvas-window').count(), {
        timeout: 2_800,
        intervals: [50, 100, 200],
      })
      .toBe(0)
    expect(Date.now() - mutationStartedAt).toBeLessThan(3_000)
    await expect
      .poll(() => page.getByTestId('workspace-taskbar-pin').count(), {
        timeout: 2_800,
        intervals: [50, 100, 200],
      })
      .toBe(0)
  } finally {
    await replaceTaskbarPins(request, [])
    await request.post('/api/files/delete', { data: { path: filePath } })
  }
})

test('zooms out and pans to keep existing and newly opened cards visible', async ({ page }) => {
  await addFileBrowser(page)
  await addFileBrowser(page)
  await expect
    .poll(async () => Number(await page.getByRole('slider', { name: 'Canvas zoom' }).inputValue()))
    .toBeLessThan(100)
  await page.waitForTimeout(300)
  const viewport = page.viewportSize()!
  const taskbar = await page.locator('header').boundingBox()
  for (const card of await page.getByTestId('canvas-window').all()) {
    const box = await card.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
    expect(box!.y + box!.height).toBeLessThanOrEqual(taskbar!.y)
  }
})

test('keeps inactive tab content mounted and does not pan when switching tabs', async ({
  page,
  request,
}) => {
  const id = new URL(page.url()).searchParams.get('ws')!
  const windows = ['one', 'two'].map((windowId, index) => ({
    id: windowId,
    type: 'browser',
    title: `Browser ${index + 1}`,
    source: { kind: 'local' },
    initialState: {},
    tabGroupId: 'one',
    layout: { bounds: { x: 80, y: 80, width: 640, height: 480 }, zIndex: 1 },
  }))
  await replaceCanvasWorkspace(request, id, {
    ...canvasSnapshot(windows),
    activeWindowId: 'one',
    activeTabMap: { one: 'one' },
  })
  await page.reload()
  const firstPane = page.locator('[data-canvas-pane-id="one"] > *').first()
  await firstPane.evaluate((element) => element.setAttribute('data-mount-marker', 'preserved'))
  const transform = await page.getByTestId('canvas-world').getAttribute('style')
  await page.locator('[data-workspace-tab-id="two"]').click()
  await page.locator('[data-workspace-tab-id="one"]').click()
  await expect(firstPane).toHaveAttribute('data-mount-marker', 'preserved')
  await expect(page.getByTestId('canvas-world')).toHaveAttribute('style', transform!)
})

test('supports split divider resizing and tab pull into another group', async ({
  page,
  request,
}) => {
  const id = new URL(page.url()).searchParams.get('ws')!
  const grouped = ['one', 'two'].map((windowId, index) => ({
    id: windowId,
    type: 'browser',
    title: `Grouped ${index + 1}`,
    source: { kind: 'local' },
    initialState: {},
    tabGroupId: 'one',
    layout: { bounds: { x: 40, y: 80, width: 560, height: 480 }, zIndex: 1 },
  }))
  const third = {
    id: 'three',
    type: 'browser',
    title: 'Third',
    source: { kind: 'local' },
    initialState: {},
    tabGroupId: null,
    layout: { bounds: { x: 660, y: 80, width: 560, height: 480 }, zIndex: 2 },
  }
  await replaceCanvasWorkspace(request, id, {
    ...canvasSnapshot([...grouped, third]),
    activeWindowId: 'two',
    activeTabMap: { one: 'two' },
    tabGroupSplits: { one: { leftTabId: 'one', leftPaneFraction: 0.5 } },
  } as any)
  await page.reload()
  const left = page.locator('[data-canvas-pane-id="one"]')
  const divider = page.getByTestId('workspace-split-divider')
  const widthBefore = (await left.boundingBox())!.width
  const dividerBox = await divider.boundingBox()
  await page.mouse.move(dividerBox!.x + dividerBox!.width / 2, dividerBox!.y + 80)
  await page.mouse.down()
  await page.mouse.move(dividerBox!.x + 100, dividerBox!.y + 80, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => (await left.boundingBox())!.width).toBeGreaterThan(widthBefore)

  const pulled = await page.locator('[data-workspace-tab-id="two"]').boundingBox()
  const target = await page.locator('[data-workspace-tab-id="three"]').boundingBox()
  await page.mouse.move(pulled!.x + pulled!.width / 2, pulled!.y + pulled!.height / 2)
  await page.mouse.down()
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, {
    steps: 16,
  })
  await expect(page.locator('[data-canvas-group-id="two"]')).toHaveCSS('opacity', '0.55')
  await page.mouse.up()
  await expect(page.getByTestId('canvas-window')).toHaveCount(2)
  const targetCard = page.locator('[data-canvas-group-id="three"]')
  await expect(targetCard.locator('[data-workspace-tab-id]')).toHaveCount(2)
})

test('keeps a grouped card maximized while switching tabs', async ({ page, request }) => {
  const id = new URL(page.url()).searchParams.get('ws')!
  const windows = ['one', 'two'].map((windowId, index) => ({
    id: windowId,
    type: 'browser',
    title: `Browser ${index + 1}`,
    source: { kind: 'local' },
    initialState: {},
    tabGroupId: 'one',
    layout: { bounds: { x: 80, y: 80, width: 640, height: 480 }, zIndex: 1 },
  }))
  await replaceCanvasWorkspace(request, id, {
    ...canvasSnapshot(windows),
    activeWindowId: 'one',
    activeTabMap: { one: 'one' },
  })
  await page.reload()
  await page.getByRole('button', { name: 'Maximize' }).click()
  await page.locator('[data-workspace-tab-id="two"]').click()
  await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible()
  await expect(page.getByTestId('canvas-zoom-control')).toHaveCount(0)
})

test('deletes a selected card as a complete tab group', async ({ page, request }) => {
  const id = new URL(page.url()).searchParams.get('ws')!
  const windows = ['one', 'two'].map((windowId, index) => ({
    id: windowId,
    type: 'browser',
    title: `Browser ${index + 1}`,
    source: { kind: 'local' },
    initialState: {},
    tabGroupId: 'one',
    layout: { bounds: { x: 80, y: 80, width: 640, height: 480 }, zIndex: 1 },
  }))
  await replaceCanvasWorkspace(request, id, {
    ...canvasSnapshot(windows),
    activeWindowId: 'one',
    activeTabMap: { one: 'one' },
  })
  await page.reload()
  await page.locator('[data-workspace-tab-id="one"]').click()
  await page.keyboard.press('Delete')
  await expect(page.getByTestId('canvas-window')).toHaveCount(0)
})

test('moves a canvas card into a desktop workspace after the shared dwell', async ({
  page,
  request,
}) => {
  const sourceId = new URL(page.url()).searchParams.get('ws')!
  await nameWorkspace(request, sourceId, `Canvas source ${Date.now()}`)
  await page.reload()
  await addFileBrowser(page)
  await expect(page.getByTestId('canvas-window')).toHaveCount(1)
  await expectWorkspaceWindowCount(request, sourceId, 1)
  const destinationId = `canvas-desktop-target-${Date.now()}`
  const destinationName = `Desktop target ${Date.now()}`
  const destinationWindow = {
    id: 'desktop-window',
    type: 'browser',
    title: 'Desktop browser',
    source: { kind: 'local' },
    initialState: {},
    tabGroupId: null,
    layout: { bounds: { x: 40, y: 40, width: 640, height: 480 }, zIndex: 1 },
  }
  const opened = await request.post('/api/workspaces/open', {
    data: {
      id: destinationId,
      clientId: CLIENT_ID,
      snapshot: {
        workspaceType: 'desktop',
        windows: [destinationWindow],
        activeWindowId: destinationWindow.id,
        activeTabMap: {},
        nextWindowId: 2,
      },
    },
  })
  expect(opened.ok()).toBe(true)
  await nameWorkspace(request, destinationId, destinationName)
  await page.reload()

  await dragFirstCanvasWindowToWorkspace(page, destinationName)
  await expect(page).toHaveURL(new RegExp(`ws=${destinationId}(?:&|$)`))
  await expect
    .poll(async () => {
      const registry = await request
        .get(`/api/workspaces?clientId=${encodeURIComponent(CLIENT_ID)}`)
        .then((response) => response.json())
      const windows = registry.records[destinationId]?.snapshot.windows ?? []
      return {
        count: windows.length,
        keptDestination: windows.some(
          (window: { title: string }) => window.title === 'Desktop browser',
        ),
      }
    })
    .toEqual({ count: 2, keptDestination: true })
  await expect(page.locator('.workspace-layout')).toBeVisible()
  await expect(page.locator('[data-window-group]')).toHaveCount(2)

  await page.goto(`/workspace?ws=${encodeURIComponent(sourceId)}`)
  await expect(page.getByTestId('infinite-canvas')).toBeVisible()
  await expect(page.getByTestId('canvas-window')).toHaveCount(0)
  await page.waitForTimeout(750)
  await page.reload()
  await expect(page.getByTestId('canvas-window')).toHaveCount(0)
  await expect
    .poll(async () => {
      const registry = await request
        .get(`/api/workspaces?clientId=${encodeURIComponent(CLIENT_ID)}`)
        .then((response) => response.json())
      return registry.records[sourceId]?.snapshot.windows.length
    })
    .toBe(0)
})
