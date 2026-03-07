import { test, expect, type Page, type Locator } from '@playwright/test'

const TASKBAR_HEIGHT = 44

async function gotoWorkspace(page: Page) {
  await page.goto('/workspace')
  await page.evaluate(() => localStorage.removeItem('workspace-state'))
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.locator('[data-window-group]')).toBeVisible()
}

async function openBrowserWindow(page: Page) {
  await page.locator('button[title="Open browser window"]').click()
  await page.waitForTimeout(300)
}

function getWindowGroups(page: Page) {
  return page.locator('[data-window-group]')
}

function getRndWrapper(windowGroup: Locator) {
  return windowGroup.locator('..')
}

function getDragHandle(windowGroup: Locator) {
  return windowGroup.locator('.workspace-window-drag-handle')
}

async function getWindowBounds(windowGroup: Locator) {
  const rnd = getRndWrapper(windowGroup)
  const box = await rnd.boundingBox()
  return box!
}

async function dragFromTo(
  page: Page,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  steps = 20,
) {
  await page.mouse.move(fromX, fromY)
  await page.mouse.down()
  await page.mouse.move(toX, toY, { steps })
  await page.mouse.up()
}

async function dragToEdge(
  page: Page,
  handle: Locator,
  target: 'left' | 'right' | 'top' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right',
) {
  const viewport = page.viewportSize()!
  const box = await handle.boundingBox()
  if (!box) throw new Error('Handle not visible')

  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2

  const containerHeight = viewport.height - TASKBAR_HEIGHT
  let endX: number
  let endY: number

  switch (target) {
    case 'left':
      endX = 5
      endY = containerHeight / 2
      break
    case 'right':
      endX = viewport.width - 5
      endY = containerHeight / 2
      break
    case 'top':
      endX = viewport.width / 2
      endY = 5
      break
    case 'top-left':
      endX = 5
      endY = 5
      break
    case 'top-right':
      endX = viewport.width - 5
      endY = 5
      break
    case 'bottom-left':
      endX = 5
      endY = containerHeight - 5
      break
    case 'bottom-right':
      endX = viewport.width - 5
      endY = containerHeight - 5
      break
  }

  await dragFromTo(page, startX, startY, endX, endY)
  await page.waitForTimeout(200)
}

async function closeAllWindows(page: Page) {
  const closeBtns = page.locator('button[aria-label^="Close "]')
  while ((await closeBtns.count()) > 0) {
    await closeBtns.first().click()
    await page.waitForTimeout(200)
  }
}

test.describe('Edge Snapping', () => {
  test('snaps window to left half', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    await expect(groups).toHaveCount(1)

    const handle = getDragHandle(groups.first())
    await dragToEdge(page, handle, 'left')

    const bounds = await getWindowBounds(groups.first())
    const viewport = page.viewportSize()!
    const halfW = Math.round(viewport.width / 2)

    expect(bounds.x).toBeLessThanOrEqual(2)
    expect(bounds.width).toBeGreaterThan(halfW - 20)
    expect(bounds.width).toBeLessThan(halfW + 20)
  })

  test('snaps window to right half', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    const handle = getDragHandle(groups.first())
    await dragToEdge(page, handle, 'right')

    const bounds = await getWindowBounds(groups.first())
    const viewport = page.viewportSize()!
    const halfW = Math.round(viewport.width / 2)

    expect(bounds.x).toBeGreaterThan(halfW - 20)
    expect(bounds.x).toBeLessThan(halfW + 20)
    expect(bounds.width).toBeGreaterThan(halfW - 20)
  })

  test('snaps window to top-left quarter', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    const handle = getDragHandle(groups.first())
    await dragToEdge(page, handle, 'top-left')

    const bounds = await getWindowBounds(groups.first())
    const viewport = page.viewportSize()!
    const halfW = Math.round(viewport.width / 2)
    const containerH = viewport.height - TASKBAR_HEIGHT
    const halfH = Math.round(containerH / 2)

    expect(bounds.x).toBeLessThanOrEqual(2)
    expect(bounds.y).toBeLessThanOrEqual(2)
    expect(bounds.width).toBeGreaterThan(halfW - 20)
    expect(bounds.width).toBeLessThan(halfW + 20)
    expect(bounds.height).toBeGreaterThan(halfH - 20)
    expect(bounds.height).toBeLessThan(halfH + 20)
  })

  test('snaps window to top-right quarter', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    const handle = getDragHandle(groups.first())
    await dragToEdge(page, handle, 'top-right')

    const bounds = await getWindowBounds(groups.first())
    const viewport = page.viewportSize()!
    const halfW = Math.round(viewport.width / 2)
    const containerH = viewport.height - TASKBAR_HEIGHT
    const halfH = Math.round(containerH / 2)

    expect(bounds.x).toBeGreaterThan(halfW - 20)
    expect(bounds.y).toBeLessThanOrEqual(2)
    expect(bounds.width).toBeGreaterThan(halfW - 20)
    expect(bounds.height).toBeGreaterThan(halfH - 20)
    expect(bounds.height).toBeLessThan(halfH + 20)
  })

  test('snaps window to bottom-left quarter', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    const handle = getDragHandle(groups.first())
    await dragToEdge(page, handle, 'bottom-left')

    const bounds = await getWindowBounds(groups.first())
    const containerH = page.viewportSize()!.height - TASKBAR_HEIGHT
    const halfH = Math.round(containerH / 2)

    expect(bounds.x).toBeLessThanOrEqual(2)
    expect(bounds.y).toBeGreaterThan(halfH - 20)
    expect(bounds.y).toBeLessThan(halfH + 20)
  })

  test('snaps window to bottom-right quarter', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    const handle = getDragHandle(groups.first())
    await dragToEdge(page, handle, 'bottom-right')

    const bounds = await getWindowBounds(groups.first())
    const viewport = page.viewportSize()!
    const halfW = Math.round(viewport.width / 2)
    const containerH = viewport.height - TASKBAR_HEIGHT
    const halfH = Math.round(containerH / 2)

    expect(bounds.x).toBeGreaterThan(halfW - 20)
    expect(bounds.y).toBeGreaterThan(halfH - 20)
  })

  test('maximizes window by dragging to top edge', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    const handle = getDragHandle(groups.first())
    await dragToEdge(page, handle, 'top')

    const bounds = await getWindowBounds(groups.first())
    const viewport = page.viewportSize()!
    const containerH = viewport.height - TASKBAR_HEIGHT

    expect(bounds.x).toBeLessThanOrEqual(2)
    expect(bounds.y).toBeLessThanOrEqual(2)
    expect(bounds.width).toBeGreaterThan(viewport.width - 10)
    expect(bounds.height).toBeGreaterThan(containerH - 10)
  })

  test('shows snap preview while dragging near edge', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    const handle = getDragHandle(groups.first())

    const box = await handle.boundingBox()
    if (!box) throw new Error('Handle not visible')
    const startX = box.x + box.width / 2
    const startY = box.y + box.height / 2

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(5, page.viewportSize()!.height / 2, { steps: 20 })

    const preview = page.locator('[data-snap-preview]')
    await expect(preview).toHaveCSS('display', 'block')

    await page.mouse.up()
  })

  test('restores window from snapped state when dragged away', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)

    const preBounds = await getWindowBounds(groups.first())

    const handle = getDragHandle(groups.first())
    await dragToEdge(page, handle, 'left')
    await page.waitForTimeout(200)

    const snappedBounds = await getWindowBounds(groups.first())
    expect(snappedBounds.width).not.toBeCloseTo(preBounds.width, -1)

    const handle2 = getDragHandle(groups.first())
    const snappedBox = await handle2.boundingBox()
    if (!snappedBox) throw new Error('Handle not visible')
    await dragFromTo(
      page,
      snappedBox.x + snappedBox.width / 2,
      snappedBox.y + snappedBox.height / 2,
      page.viewportSize()!.width / 2,
      page.viewportSize()!.height / 3,
    )
    await page.waitForTimeout(200)

    const restoredBounds = await getWindowBounds(groups.first())
    expect(restoredBounds.width).toBeLessThan(snappedBounds.width)
  })
})

test.describe('Tab Merging and Splitting', () => {
  test('merges window into another as tab', async ({ page }) => {
    await gotoWorkspace(page)
    await openBrowserWindow(page)
    const groups = getWindowGroups(page)
    await expect(groups).toHaveCount(2)

    const handleB = getDragHandle(groups.nth(1))
    const boxB = await handleB.boundingBox()
    const boxA = await getDragHandle(groups.first()).boundingBox()
    if (!boxB || !boxA) throw new Error('Handles not visible')

    await dragFromTo(
      page,
      boxB.x + boxB.width / 2,
      boxB.y + boxB.height / 2,
      boxA.x + boxA.width / 2,
      boxA.y + boxA.height / 4,
    )
    await page.waitForTimeout(300)

    await expect(getWindowGroups(page)).toHaveCount(1)
    const tabStrip = page.locator('.workspace-tab-strip')
    await expect(tabStrip).toBeVisible()
  })

  test('splits tab into separate window', async ({ page }) => {
    await gotoWorkspace(page)
    await openBrowserWindow(page)

    const groups = getWindowGroups(page)
    const handleB = getDragHandle(groups.nth(1))
    const boxB = await handleB.boundingBox()
    const boxA = await getDragHandle(groups.first()).boundingBox()
    if (!boxB || !boxA) throw new Error('Handles not visible')

    await dragFromTo(
      page,
      boxB.x + boxB.width / 2,
      boxB.y + boxB.height / 2,
      boxA.x + boxA.width / 2,
      boxA.y + boxA.height / 4,
    )
    await page.waitForTimeout(300)
    await expect(getWindowGroups(page)).toHaveCount(1)

    const tabStrip = page.locator('.workspace-tab-strip')
    const tabs = tabStrip
      .locator('[data-no-window-drag]')
      .filter({ hasNotText: '◂' })
      .filter({ hasNotText: '▸' })
    const secondTab = tabs.nth(1)
    const tabBox = await secondTab.boundingBox()
    if (!tabBox) throw new Error('Tab not visible')

    await dragFromTo(
      page,
      tabBox.x + tabBox.width / 2,
      tabBox.y + tabBox.height / 2,
      tabBox.x + tabBox.width / 2,
      tabBox.y + tabBox.height / 2 + 60,
    )
    await page.waitForTimeout(300)

    await expect(getWindowGroups(page)).toHaveCount(2)
  })

  test('shows correct tab count in taskbar after merge', async ({ page }) => {
    await gotoWorkspace(page)
    await openBrowserWindow(page)

    const groups = getWindowGroups(page)
    const handleB = getDragHandle(groups.nth(1))
    const boxB = await handleB.boundingBox()
    const boxA = await getDragHandle(groups.first()).boundingBox()
    if (!boxB || !boxA) throw new Error('Handles not visible')

    await dragFromTo(
      page,
      boxB.x + boxB.width / 2,
      boxB.y + boxB.height / 2,
      boxA.x + boxA.width / 2,
      boxA.y + boxA.height / 4,
    )
    await page.waitForTimeout(300)

    const taskbarCloseBtn = page.locator('button[aria-label^="Close "]')
    const label = await taskbarCloseBtn.first().getAttribute('aria-label')
    expect(label).toContain('+1')
  })

  test('switching tabs changes active tab styling', async ({ page }) => {
    await gotoWorkspace(page)
    await openBrowserWindow(page)

    const groups = getWindowGroups(page)
    const handleB = getDragHandle(groups.nth(1))
    const boxB = await handleB.boundingBox()
    const boxA = await getDragHandle(groups.first()).boundingBox()
    if (!boxB || !boxA) throw new Error('Handles not visible')

    await dragFromTo(
      page,
      boxB.x + boxB.width / 2,
      boxB.y + boxB.height / 2,
      boxA.x + boxA.width / 2,
      boxA.y + boxA.height / 4,
    )
    await page.waitForTimeout(300)

    const tabStrip = page.locator('.workspace-tab-strip')
    const tabs = tabStrip
      .locator('[data-no-window-drag]')
      .filter({ hasNotText: '◂' })
      .filter({ hasNotText: '▸' })
    await expect(tabs).toHaveCount(2)

    await tabs.first().click()
    await page.waitForTimeout(100)
    await expect(tabs.first()).toHaveClass(/bg-neutral-950/)
  })

  test('closing one tab keeps the other', async ({ page }) => {
    await gotoWorkspace(page)
    await openBrowserWindow(page)

    const groups = getWindowGroups(page)
    const handleB = getDragHandle(groups.nth(1))
    const boxB = await handleB.boundingBox()
    const boxA = await getDragHandle(groups.first()).boundingBox()
    if (!boxB || !boxA) throw new Error('Handles not visible')

    await dragFromTo(
      page,
      boxB.x + boxB.width / 2,
      boxB.y + boxB.height / 2,
      boxA.x + boxA.width / 2,
      boxA.y + boxA.height / 4,
    )
    await page.waitForTimeout(300)

    const tabStrip = page.locator('.workspace-tab-strip')
    const closeButtons = tabStrip.locator('button:has(.lucide-x)')
    await closeButtons.last().click()
    await page.waitForTimeout(200)

    await expect(getWindowGroups(page)).toHaveCount(1)
  })
})

test.describe('Resizing Snapped Windows', () => {
  test('resizes shared edge between left and right snapped windows', async ({ page }) => {
    await gotoWorkspace(page)
    await openBrowserWindow(page)

    const groups = getWindowGroups(page)

    await dragToEdge(page, getDragHandle(groups.first()), 'left')
    await page.waitForTimeout(300)
    await groups.nth(1).dispatchEvent('mousedown')
    await page.waitForTimeout(100)
    await dragToEdge(page, getDragHandle(groups.nth(1)), 'right')
    await page.waitForTimeout(300)

    const boundsA = await getWindowBounds(groups.first())
    const boundsB = await getWindowBounds(groups.nth(1))
    const leftWindow = boundsA.x < boundsB.x ? groups.first() : groups.nth(1)
    const rightWindow = boundsA.x < boundsB.x ? groups.nth(1) : groups.first()

    const leftBounds = boundsA.x < boundsB.x ? boundsA : boundsB
    const rightBounds = boundsA.x < boundsB.x ? boundsB : boundsA

    expect(leftBounds.x).toBeLessThanOrEqual(5)
    expect(rightBounds.x).toBeGreaterThan(leftBounds.width - 20)

    const leftRnd = getRndWrapper(leftWindow)
    const resizeHandle = leftRnd.locator('div[style*="col-resize"]').first()
    await expect(resizeHandle).toBeAttached()

    const handleBox = await resizeHandle.boundingBox()
    if (!handleBox) throw new Error('Resize handle not found')

    const startX = handleBox.x + handleBox.width / 2
    const startY = handleBox.y + handleBox.height / 2
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + 80, startY, { steps: 15 })
    await page.mouse.up()
    await page.waitForTimeout(500)

    const newLeftBounds = await getWindowBounds(leftWindow)
    const newRightBounds = await getWindowBounds(rightWindow)

    expect(newLeftBounds.width).toBeGreaterThan(leftBounds.width)
    expect(newRightBounds.x).toBeGreaterThan(rightBounds.x)
  })

  test('resizes shared edge between top and bottom quarter windows', async ({ page }) => {
    await gotoWorkspace(page)
    await openBrowserWindow(page)

    const groups = getWindowGroups(page)

    await dragToEdge(page, getDragHandle(groups.first()), 'top-left')
    await page.waitForTimeout(300)
    await groups.nth(1).dispatchEvent('mousedown')
    await page.waitForTimeout(100)
    await dragToEdge(page, getDragHandle(groups.nth(1)), 'bottom-left')
    await page.waitForTimeout(300)

    const boundsA = await getWindowBounds(groups.first())
    const boundsB = await getWindowBounds(groups.nth(1))
    const topWindow = boundsA.y < boundsB.y ? groups.first() : groups.nth(1)
    const bottomWindow = boundsA.y < boundsB.y ? groups.nth(1) : groups.first()

    const topBounds = boundsA.y < boundsB.y ? boundsA : boundsB
    const bottomBounds = boundsA.y < boundsB.y ? boundsB : boundsA

    expect(topBounds.y).toBeLessThanOrEqual(5)
    expect(bottomBounds.y).toBeGreaterThan(topBounds.height - 20)

    const topRnd = getRndWrapper(topWindow)
    const resizeHandle = topRnd.locator('div[style*="row-resize"]').first()
    await expect(resizeHandle).toBeAttached()

    const handleBox = await resizeHandle.boundingBox()
    if (!handleBox) throw new Error('Resize handle not found')

    const startX = handleBox.x + handleBox.width / 2
    const startY = handleBox.y + handleBox.height / 2
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX, startY + 60, { steps: 15 })
    await page.mouse.up()
    await page.waitForTimeout(500)

    const newTopBounds = await getWindowBounds(topWindow)
    const newBottomBounds = await getWindowBounds(bottomWindow)

    expect(newTopBounds.height).toBeGreaterThan(topBounds.height)
    expect(newBottomBounds.y).toBeGreaterThan(bottomBounds.y)
  })
})

test.describe('Taskbar', () => {
  test('shows empty state when no windows open', async ({ page }) => {
    await gotoWorkspace(page)
    await closeAllWindows(page)
    await expect(page.getByText('No windows are open')).toBeVisible()
  })

  test('shows open browser button', async ({ page }) => {
    await gotoWorkspace(page)
    await expect(page.locator('button[title="Open browser window"]')).toBeVisible()
  })

  test('opens a browser window from taskbar', async ({ page }) => {
    await gotoWorkspace(page)
    await expect(getWindowGroups(page)).toHaveCount(1)
    await openBrowserWindow(page)
    await expect(getWindowGroups(page)).toHaveCount(2)
  })

  test('clicking taskbar item focuses window', async ({ page }) => {
    await gotoWorkspace(page)
    await openBrowserWindow(page)

    const taskbarCloseButtons = page.locator('button[aria-label^="Close "]')
    const firstCloseBtn = taskbarCloseButtons.first()
    const firstTaskbarItem = firstCloseBtn.locator('..')
    await firstTaskbarItem.locator('button').first().click()
    await page.waitForTimeout(200)

    await expect(firstTaskbarItem).toHaveClass(/bg-white\/10/)
  })

  test('restores minimized window from taskbar', async ({ page }) => {
    await gotoWorkspace(page)
    await expect(getWindowGroups(page)).toHaveCount(1)

    const groups = getWindowGroups(page)
    const minimizeBtn = groups.first().locator('button:has(.lucide-minus)')
    await minimizeBtn.click()
    await page.waitForTimeout(200)
    await expect(getWindowGroups(page)).toHaveCount(0)

    const taskbarCloseButtons = page.locator('button[aria-label^="Close "]')
    const firstTaskbarItem = taskbarCloseButtons.first().locator('..')
    await firstTaskbarItem.locator('button').first().click()
    await page.waitForTimeout(200)

    await expect(getWindowGroups(page)).toHaveCount(1)
  })

  test('closes window from taskbar', async ({ page }) => {
    await gotoWorkspace(page)
    await expect(getWindowGroups(page)).toHaveCount(1)

    const taskbarCloseBtn = page.locator('button[aria-label^="Close "]')
    await taskbarCloseBtn.first().click()
    await page.waitForTimeout(200)

    await expect(getWindowGroups(page)).toHaveCount(0)
  })
})

test.describe('Window Buttons', () => {
  test('minimize button hides window', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    await expect(groups).toHaveCount(1)

    const minimizeBtn = groups.first().locator('button:has(.lucide-minus)')
    await minimizeBtn.click()
    await page.waitForTimeout(200)

    await expect(getWindowGroups(page)).toHaveCount(0)
  })

  test('maximize button expands to fullscreen', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)

    const maximizeBtn = groups.first().locator('button:has(.lucide-maximize-2)')
    await maximizeBtn.click()
    await page.waitForTimeout(200)

    const bounds = await getWindowBounds(groups.first())
    const viewport = page.viewportSize()!
    const containerH = viewport.height - TASKBAR_HEIGHT

    expect(bounds.width).toBeGreaterThan(viewport.width - 10)
    expect(bounds.height).toBeGreaterThan(containerH - 10)
  })

  test('maximize button restores from fullscreen', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)

    const preBounds = await getWindowBounds(groups.first())

    const maximizeBtn = groups.first().locator('button:has(.lucide-maximize-2)')
    await maximizeBtn.click()
    await page.waitForTimeout(200)

    const restoreBtn = groups.first().locator('button:has(.lucide-minimize-2)')
    await restoreBtn.click()
    await page.waitForTimeout(200)

    const restoredBounds = await getWindowBounds(groups.first())
    const viewport = page.viewportSize()!

    expect(restoredBounds.width).toBeLessThan(viewport.width - 50)
    expect(restoredBounds.height).toBeLessThan(viewport.height - 50)
    expect(restoredBounds.width).toBeGreaterThan(preBounds.width - 20)
    expect(restoredBounds.width).toBeLessThan(preBounds.width + 20)
  })

  test('close button removes window', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    await expect(groups).toHaveCount(1)

    const closeBtn = groups
      .first()
      .locator('.workspace-window-drag-handle > .flex.shrink-0 > button:has(.lucide-x)')
    await closeBtn.click()
    await page.waitForTimeout(200)

    await expect(getWindowGroups(page)).toHaveCount(0)
  })

  test('add tab button adds a new tab', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)

    const addTabBtn = groups.first().locator('button:has(.lucide-plus)')
    await addTabBtn.click()
    await page.waitForTimeout(300)

    const tabStrip = page.locator('.workspace-tab-strip')
    await expect(tabStrip).toBeVisible()
  })

  test('right-click maximize opens layout picker', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)

    const maximizeBtn = groups.first().locator('button:has(.lucide-maximize-2)')
    await maximizeBtn.click({ button: 'right' })
    await page.waitForTimeout(200)

    await expect(page.getByText('Snap layout')).toBeVisible()
  })

  test('selecting a layout from picker snaps window', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)

    const maximizeBtn = groups.first().locator('button:has(.lucide-maximize-2)')
    await maximizeBtn.click({ button: 'right' })
    await page.waitForTimeout(200)

    const pickerSlots = page.locator('.grid.h-12.w-16 button')
    await pickerSlots.first().click()
    await page.waitForTimeout(300)

    const bounds = await getWindowBounds(groups.first())
    const viewport = page.viewportSize()!
    const containerH = viewport.height - TASKBAR_HEIGHT

    expect(bounds.width).toBeGreaterThan(viewport.width - 10)
    expect(bounds.height).toBeGreaterThan(containerH - 10)
  })
})

test.describe('State Persistence', () => {
  test('windows survive page reload', async ({ page }) => {
    await gotoWorkspace(page)
    await openBrowserWindow(page)
    await expect(getWindowGroups(page)).toHaveCount(2)

    await page.waitForTimeout(600)
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(getWindowGroups(page).first()).toBeVisible()

    await expect(getWindowGroups(page)).toHaveCount(2)
  })

  test('snap state persists across reload', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    const handle = getDragHandle(groups.first())
    await dragToEdge(page, handle, 'left')
    await page.waitForTimeout(600)

    const snappedBounds = await getWindowBounds(groups.first())

    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(getWindowGroups(page).first()).toBeVisible()

    const reloadedBounds = await getWindowBounds(getWindowGroups(page).first())
    expect(reloadedBounds.x).toBeLessThanOrEqual(2)
    expect(reloadedBounds.width).toBeGreaterThan(snappedBounds.width - 20)
    expect(reloadedBounds.width).toBeLessThan(snappedBounds.width + 20)
  })

  test('tab groups persist across reload', async ({ page }) => {
    await gotoWorkspace(page)
    await openBrowserWindow(page)

    const groups = getWindowGroups(page)
    const handleB = getDragHandle(groups.nth(1))
    const boxB = await handleB.boundingBox()
    const boxA = await getDragHandle(groups.first()).boundingBox()
    if (!boxB || !boxA) throw new Error('Handles not visible')

    await dragFromTo(
      page,
      boxB.x + boxB.width / 2,
      boxB.y + boxB.height / 2,
      boxA.x + boxA.width / 2,
      boxA.y + boxA.height / 4,
    )
    await page.waitForTimeout(600)
    await expect(getWindowGroups(page)).toHaveCount(1)

    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(getWindowGroups(page).first()).toBeVisible()

    await expect(getWindowGroups(page)).toHaveCount(1)
    const tabStrip = page.locator('.workspace-tab-strip')
    await expect(tabStrip).toBeVisible()
  })

  test('player window is excluded from persistence', async ({ page }) => {
    await gotoWorkspace(page)

    const groups = getWindowGroups(page)
    const content = groups.first().locator('.workspace-window-content')
    await content.getByText('Videos', { exact: true }).click()
    await page.waitForTimeout(300)
    await content.getByText('sample.mp4').click()
    await page.waitForTimeout(600)

    const allGroups = getWindowGroups(page)
    const count = await allGroups.count()
    expect(count).toBeGreaterThanOrEqual(2)

    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(getWindowGroups(page).first()).toBeVisible()

    const reloadedVideo = page.locator('[data-window-group] video')
    await expect(reloadedVideo).toHaveCount(0)
  })
})

test.describe('Window Z-Ordering and Focus', () => {
  test('clicking background window brings it to front', async ({ page }) => {
    await gotoWorkspace(page)
    await openBrowserWindow(page)
    const groups = getWindowGroups(page)

    const rndA = getRndWrapper(groups.first())
    const rndB = getRndWrapper(groups.nth(1))

    const zB = await rndB.evaluate((el) => parseInt(el.style.zIndex || '0'))
    const zA = await rndA.evaluate((el) => parseInt(el.style.zIndex || '0'))
    expect(zB).toBeGreaterThan(zA)

    await groups.first().dispatchEvent('mousedown')
    await page.waitForTimeout(200)

    const newZA = await rndA.evaluate((el) => parseInt(el.style.zIndex || '0'))
    expect(newZA).toBeGreaterThan(zB)
  })

  test('newly opened window is focused', async ({ page }) => {
    await gotoWorkspace(page)
    await openBrowserWindow(page)
    const groups = getWindowGroups(page)

    await expect(groups.nth(1)).toHaveClass(/border-white\/12/)
  })

  test('active window has distinct border', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    await expect(groups.first()).toHaveClass(/border-white\/12/)

    await openBrowserWindow(page)
    const updatedGroups = getWindowGroups(page)
    await expect(updatedGroups.first()).not.toHaveClass(/border-white\/12/)
    await expect(updatedGroups.nth(1)).toHaveClass(/border-white\/12/)
  })
})

test.describe('Tiling Layout Picker', () => {
  test('selects full-screen layout', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)

    const maximizeBtn = groups.first().locator('button:has(.lucide-maximize-2)')
    await maximizeBtn.click({ button: 'right' })
    await page.waitForTimeout(200)

    const templates = page.locator('.grid.h-12.w-16')
    const fullTemplate = templates.first()
    await fullTemplate.locator('button').first().click()
    await page.waitForTimeout(300)

    const bounds = await getWindowBounds(groups.first())
    const viewport = page.viewportSize()!
    const containerH = viewport.height - TASKBAR_HEIGHT

    expect(bounds.width).toBeGreaterThan(viewport.width - 10)
    expect(bounds.height).toBeGreaterThan(containerH - 10)
  })

  test('selects left-right split', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)

    const maximizeBtn = groups.first().locator('button:has(.lucide-maximize-2)')
    await maximizeBtn.click({ button: 'right' })
    await page.waitForTimeout(200)

    const templates = page.locator('.grid.h-12.w-16')
    const leftRightTemplate = templates.nth(1)
    await leftRightTemplate.locator('button').first().click()
    await page.waitForTimeout(300)

    const bounds = await getWindowBounds(groups.first())
    const viewport = page.viewportSize()!
    const halfW = Math.round(viewport.width / 2)

    expect(bounds.x).toBeLessThanOrEqual(2)
    expect(bounds.width).toBeGreaterThan(halfW - 20)
    expect(bounds.width).toBeLessThan(halfW + 20)
  })

  test('selects quarter layout', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)

    const maximizeBtn = groups.first().locator('button:has(.lucide-maximize-2)')
    await maximizeBtn.click({ button: 'right' })
    await page.waitForTimeout(200)

    const templates = page.locator('.grid.h-12.w-16')
    const quartersTemplate = templates.nth(4)
    await quartersTemplate.locator('button').first().click()
    await page.waitForTimeout(300)

    const bounds = await getWindowBounds(groups.first())
    const viewport = page.viewportSize()!
    const halfW = Math.round(viewport.width / 2)
    const containerH = viewport.height - TASKBAR_HEIGHT
    const halfH = Math.round(containerH / 2)

    expect(bounds.x).toBeLessThanOrEqual(2)
    expect(bounds.y).toBeLessThanOrEqual(2)
    expect(bounds.width).toBeGreaterThan(halfW - 20)
    expect(bounds.width).toBeLessThan(halfW + 20)
    expect(bounds.height).toBeGreaterThan(halfH - 20)
    expect(bounds.height).toBeLessThan(halfH + 20)
  })

  test('picker closes on escape', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)

    const maximizeBtn = groups.first().locator('button:has(.lucide-maximize-2)')
    await maximizeBtn.click({ button: 'right' })
    await page.waitForTimeout(200)
    await expect(page.getByText('Snap layout')).toBeVisible()

    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)

    await expect(page.getByText('Snap layout')).not.toBeVisible()
  })

  test('picker closes on outside click', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)

    const maximizeBtn = groups.first().locator('button:has(.lucide-maximize-2)')
    await maximizeBtn.click({ button: 'right' })
    await page.waitForTimeout(200)
    await expect(page.getByText('Snap layout')).toBeVisible()

    const content = groups.first().locator('.workspace-window-content')
    await content.click({ position: { x: 10, y: 10 } })
    await page.waitForTimeout(200)

    await expect(page.getByText('Snap layout')).not.toBeVisible()
  })
})

test.describe('Drag Restore', () => {
  test('dragging a snapped window restores its pre-snap size', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)

    const preBounds = await getWindowBounds(groups.first())

    const handle = getDragHandle(groups.first())
    await dragToEdge(page, handle, 'left')
    await page.waitForTimeout(200)

    const snappedBounds = await getWindowBounds(groups.first())
    expect(snappedBounds.width).toBeGreaterThan(preBounds.width + 50)

    const handle2 = getDragHandle(groups.first())
    const box = await handle2.boundingBox()
    if (!box) throw new Error('Handle not visible')

    await dragFromTo(
      page,
      box.x + box.width / 2,
      box.y + box.height / 2,
      page.viewportSize()!.width / 2,
      page.viewportSize()!.height / 3,
    )
    await page.waitForTimeout(200)

    const restoredBounds = await getWindowBounds(groups.first())
    expect(restoredBounds.width).toBeGreaterThan(preBounds.width - 50)
    expect(restoredBounds.width).toBeLessThan(preBounds.width + 50)
  })

  test('dragging a maximized window restores it', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    const viewport = page.viewportSize()!

    const maximizeBtn = groups.first().locator('button:has(.lucide-maximize-2)')
    await maximizeBtn.click()
    await page.waitForTimeout(200)

    const maxBounds = await getWindowBounds(groups.first())
    expect(maxBounds.width).toBeGreaterThan(viewport.width - 10)

    const handle = getDragHandle(groups.first())
    const box = await handle.boundingBox()
    if (!box) throw new Error('Handle not visible')
    await dragFromTo(
      page,
      box.x + box.width / 2,
      box.y + box.height / 2,
      viewport.width / 2,
      viewport.height / 3,
    )
    await page.waitForTimeout(200)

    const restoredBounds = await getWindowBounds(groups.first())
    expect(restoredBounds.width).toBeLessThan(viewport.width - 50)
  })

  test('restored window follows cursor position', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)

    const handle = getDragHandle(groups.first())
    await dragToEdge(page, handle, 'left')
    await page.waitForTimeout(200)

    const handle2 = getDragHandle(groups.first())
    const box = await handle2.boundingBox()
    if (!box) throw new Error('Handle not visible')

    const dropX = 600
    const dropY = 200
    await dragFromTo(page, box.x + box.width / 2, box.y + box.height / 2, dropX, dropY)
    await page.waitForTimeout(200)

    const restoredBounds = await getWindowBounds(groups.first())
    expect(restoredBounds.x).toBeGreaterThan(dropX - restoredBounds.width)
    expect(restoredBounds.x).toBeLessThan(dropX + 10)
  })
})

test.describe('File Browsing and Viewers', () => {
  test('workspace browser shows root folders', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    const content = groups.first().locator('.workspace-window-content')

    for (const folder of ['Videos', 'Music', 'Images', 'Documents']) {
      await expect(content.getByText(folder, { exact: true })).toBeVisible()
    }
  })

  test('navigating into a folder updates browser content', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    const content = groups.first().locator('.workspace-window-content')

    await content.getByText('Videos', { exact: true }).click()
    await page.waitForTimeout(500)

    await expect(content.getByText('sample.mp4')).toBeVisible()
  })

  test('clicking a text file opens a viewer window', async ({ page }) => {
    await gotoWorkspace(page)

    const groups = getWindowGroups(page)
    const content = groups.first().locator('.workspace-window-content')

    await content.getByText('Documents', { exact: true }).click()
    await page.waitForTimeout(500)

    await content.getByText('readme.txt').click()
    await page.waitForTimeout(500)

    await expect(getWindowGroups(page)).toHaveCount(2)
  })

  test('clicking an image opens an image viewer window', async ({ page }) => {
    await gotoWorkspace(page)

    const groups = getWindowGroups(page)
    const content = groups.first().locator('.workspace-window-content')

    await content.getByText('Images', { exact: true }).click()
    await page.waitForTimeout(500)

    await content.getByText('photo.jpg').click()
    await page.waitForTimeout(500)

    await expect(getWindowGroups(page)).toHaveCount(2)
  })
})

test.describe('Window Minimum Size', () => {
  test('window cannot be resized below 360x260', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)

    const rnd = getRndWrapper(groups.first())
    const box = await rnd.boundingBox()
    if (!box) throw new Error('Window not visible')

    await dragFromTo(page, box.x + box.width, box.y + box.height, box.x + 100, box.y + 100, 30)
    await page.waitForTimeout(200)

    const newBounds = await getWindowBounds(groups.first())
    expect(newBounds.width).toBeGreaterThanOrEqual(360)
    expect(newBounds.height).toBeGreaterThanOrEqual(260)
  })
})

test.describe('Player Window Reuse', () => {
  test('playing a video creates a player window', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    const content = groups.first().locator('.workspace-window-content')

    await content.getByText('Videos', { exact: true }).click()
    await page.waitForTimeout(500)
    await content.getByText('sample.mp4').click()
    await page.waitForTimeout(500)

    const videos = page.locator('[data-window-group] video')
    await expect(videos).toHaveCount(1)
  })

  test('playing the same video again reuses the player window', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    const content = groups.first().locator('.workspace-window-content')

    await content.getByText('Videos', { exact: true }).click()
    await page.waitForTimeout(500)
    await content.getByText('sample.mp4').click()
    await page.waitForTimeout(500)

    const videos = page.locator('[data-window-group] video')
    await expect(videos).toHaveCount(1)
    const windowCountAfterFirst = await getWindowGroups(page).count()

    const browserContent = groups.first().locator('.workspace-window-content')
    await browserContent.getByText('sample.mp4').click()
    await page.waitForTimeout(500)

    await expect(page.locator('[data-window-group] video')).toHaveCount(1)
    const windowCountAfterSecond = await getWindowGroups(page).count()
    expect(windowCountAfterSecond).toBe(windowCountAfterFirst)
  })
})
