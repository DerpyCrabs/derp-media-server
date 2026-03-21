import { test, expect } from '@playwright/test'
import {
  TASKBAR_HEIGHT,
  gotoWorkspace,
  openBrowserWindow,
  getWindowGroups,
  getRndWrapper,
  getDragHandle,
  getWindowBounds,
  getSharedColumnResizeHandle,
  waitForWindowBoundsStable,
  dragFromTo,
  dragToEdge,
} from '../e2e/workspace-layout-helpers'

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

  test('minimize button works on first click after snapping window', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    await expect(groups).toHaveCount(1)

    const handle = getDragHandle(groups.first())
    await dragToEdge(page, handle, 'left')

    const minimizeBtn = groups.first().locator('button:has(.lucide-minus)')
    await minimizeBtn.click()

    await expect(getWindowGroups(page)).toHaveCount(0)
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
    await page.mouse.move(5, page.viewportSize()!.height / 2, { steps: 10 })

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
    await waitForWindowBoundsStable(page, groups.first())

    const restoredBounds = await getWindowBounds(groups.first())
    expect(restoredBounds.width).toBeLessThan(snappedBounds.width)
  })
})

test.describe('Resizing Snapped Windows', () => {
  test('resizes shared edge between left and right snapped windows', async ({ page }) => {
    await gotoWorkspace(page)
    await openBrowserWindow(page)

    const groups = getWindowGroups(page)

    await dragToEdge(page, getDragHandle(groups.first()), 'left')
    await groups.nth(1).dispatchEvent('mousedown')
    await page.waitForTimeout(30)
    await dragToEdge(page, getDragHandle(groups.nth(1)), 'right')

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
    await page.mouse.move(startX + 80, startY, { steps: 10 })
    await page.mouse.up()
    await waitForWindowBoundsStable(page, leftWindow)

    const newLeftBounds = await getWindowBounds(leftWindow)
    const newRightBounds = await getWindowBounds(rightWindow)

    expect(newLeftBounds.width).toBeGreaterThan(leftBounds.width)
    expect(newRightBounds.x).toBeGreaterThan(rightBounds.x)
  })

  test('resizing left snapped column moves both top-right and bottom-right windows', async ({
    page,
  }) => {
    await gotoWorkspace(page)
    await openBrowserWindow(page)
    await openBrowserWindow(page)

    const groups = getWindowGroups(page)
    await expect(groups).toHaveCount(3)

    await dragToEdge(page, getDragHandle(groups.nth(0)), 'left')

    await groups.nth(1).dispatchEvent('mousedown')
    await page.waitForTimeout(30)
    await dragToEdge(page, getDragHandle(groups.nth(1)), 'top-right')

    await groups.nth(2).dispatchEvent('mousedown')
    await page.waitForTimeout(30)
    await dragToEdge(page, getDragHandle(groups.nth(2)), 'bottom-right')

    await expect(groups).toHaveCount(3)
    for (let i = 0; i < 3; i++) {
      await expect(groups.nth(i)).toBeVisible()
    }

    const b0 = await getWindowBounds(groups.nth(0))
    const b1 = await getWindowBounds(groups.nth(1))
    const b2 = await getWindowBounds(groups.nth(2))
    expect(b0).toBeTruthy()
    expect(b1).toBeTruthy()
    expect(b2).toBeTruthy()

    const byX = [b0, b1, b2]
      .map((bounds, i) => ({ bounds, i }))
      .sort((a, c) => a.bounds.x - c.bounds.x)
    const leftIdx = byX[0]!.i
    const rightTopIdx = byX[1]!.bounds.y <= byX[2]!.bounds.y ? byX[1]!.i : byX[2]!.i
    const rightBottomIdx = rightTopIdx === byX[1]!.i ? byX[2]!.i : byX[1]!.i

    const leftWindow = groups.nth(leftIdx)
    const topRightWindow = groups.nth(rightTopIdx)
    const bottomRightWindow = groups.nth(rightBottomIdx)

    const leftBounds = byX[0]!.bounds
    const topRightBefore = await getWindowBounds(topRightWindow)
    const bottomRightBefore = await getWindowBounds(bottomRightWindow)

    expect(leftBounds.x).toBeLessThanOrEqual(5)
    expect(topRightBefore.x).toBeGreaterThan(leftBounds.x + leftBounds.width - 25)
    expect(bottomRightBefore.x).toBeGreaterThan(leftBounds.x + leftBounds.width - 25)
    expect(Math.abs(topRightBefore.x - bottomRightBefore.x)).toBeLessThanOrEqual(8)
    expect(Math.abs(topRightBefore.width - bottomRightBefore.width)).toBeLessThanOrEqual(8)

    const resizeHandle = await getSharedColumnResizeHandle(leftWindow)
    await expect(resizeHandle).toBeAttached()

    const handleBox = await resizeHandle.boundingBox()
    if (!handleBox) throw new Error('Resize handle not found')

    const startX = handleBox.x + handleBox.width / 2
    const startY = handleBox.y + handleBox.height / 2
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + 80, startY, { steps: 10 })
    await page.mouse.up()
    await waitForWindowBoundsStable(page, leftWindow)
    await waitForWindowBoundsStable(page, topRightWindow)
    await waitForWindowBoundsStable(page, bottomRightWindow)

    const topRightAfter = await getWindowBounds(topRightWindow)
    const bottomRightAfter = await getWindowBounds(bottomRightWindow)

    expect(topRightAfter.x).toBeGreaterThan(topRightBefore.x)
    expect(bottomRightAfter.x).toBeGreaterThan(bottomRightBefore.x)
    expect(Math.abs(topRightAfter.x - bottomRightAfter.x)).toBeLessThanOrEqual(8)
    expect(Math.abs(topRightAfter.width - bottomRightAfter.width)).toBeLessThanOrEqual(8)
  })

  test('resizes shared edge between top and bottom quarter windows', async ({ page }) => {
    await gotoWorkspace(page)
    await openBrowserWindow(page)

    const groups = getWindowGroups(page)

    await dragToEdge(page, getDragHandle(groups.first()), 'top-left')
    await groups.nth(1).dispatchEvent('mousedown')
    await page.waitForTimeout(30)
    await dragToEdge(page, getDragHandle(groups.nth(1)), 'bottom-left')

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
    await page.mouse.move(startX, startY + 60, { steps: 10 })
    await page.mouse.up()
    await waitForWindowBoundsStable(page, topWindow)

    const newTopBounds = await getWindowBounds(topWindow)
    const newBottomBounds = await getWindowBounds(bottomWindow)

    expect(newTopBounds.height).toBeGreaterThan(topBounds.height)
    expect(newBottomBounds.y).toBeGreaterThan(bottomBounds.y)
  })

  test('resizes shared edge between third layout windows (top-left-third and top-center-third)', async ({
    page,
  }) => {
    await gotoWorkspace(page)
    await openBrowserWindow(page)

    const groups = getWindowGroups(page)

    const maximizeBtn = groups.first().locator('button:has(.lucide-maximize-2)')
    await maximizeBtn.click({ button: 'right' })
    await expect(page.getByText('Snap layout')).toBeVisible()

    const templates = page.locator('[data-snap-layout-template]')
    const thirdsTemplate = templates.nth(5)
    await thirdsTemplate.locator('button').first().click()
    await waitForWindowBoundsStable(page, groups.first())

    await groups.nth(1).dispatchEvent('mousedown')
    await page.waitForTimeout(30)

    const maximizeBtn2 = groups.nth(1).locator('button:has(.lucide-maximize-2)')
    await maximizeBtn2.click({ button: 'right' })
    await expect(page.getByText('Snap layout')).toBeVisible()

    const templates2 = page.locator('[data-snap-layout-template]')
    const thirdsTemplate2 = templates2.nth(5)
    await thirdsTemplate2.locator('button').nth(1).click()
    await waitForWindowBoundsStable(page, groups.first())

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
    await page.mouse.move(startX + 80, startY, { steps: 10 })
    await page.mouse.up()
    await waitForWindowBoundsStable(page, leftWindow)

    const newLeftBounds = await getWindowBounds(leftWindow)
    const newRightBounds = await getWindowBounds(rightWindow)

    expect(newLeftBounds.width).toBeGreaterThan(leftBounds.width)
    expect(newRightBounds.x).toBeGreaterThan(rightBounds.x)
  })

  test('resizes shared edge between left-third and right-two-thirds (1/3 + 2/3 layout)', async ({
    page,
  }) => {
    await gotoWorkspace(page)
    await openBrowserWindow(page)

    const groups = getWindowGroups(page)

    const maximizeBtn = groups.first().locator('button:has(.lucide-maximize-2)')
    await maximizeBtn.click({ button: 'right' })
    await expect(page.getByText('Snap layout')).toBeVisible()

    const templates = page.locator('[data-snap-layout-template]')
    const oneThirdTwoThirdsTemplate = templates.nth(6)
    await oneThirdTwoThirdsTemplate.locator('button').first().click()
    await waitForWindowBoundsStable(page, groups.first())

    await groups.nth(1).dispatchEvent('mousedown')
    await page.waitForTimeout(30)

    const maximizeBtn2 = groups.nth(1).locator('button:has(.lucide-maximize-2)')
    await maximizeBtn2.click({ button: 'right' })
    await expect(page.getByText('Snap layout')).toBeVisible()

    const templates2 = page.locator('[data-snap-layout-template]')
    const oneThirdTwoThirdsTemplate2 = templates2.nth(6)
    await oneThirdTwoThirdsTemplate2.locator('button').nth(1).click()
    await waitForWindowBoundsStable(page, groups.first())

    const boundsA = await getWindowBounds(groups.first())
    const boundsB = await getWindowBounds(groups.nth(1))
    const leftWindow = boundsA.x < boundsB.x ? groups.first() : groups.nth(1)
    const rightWindow = boundsA.x < boundsB.x ? groups.nth(1) : groups.first()

    const leftBounds = boundsA.x < boundsB.x ? boundsA : boundsB
    const rightBounds = boundsA.x < boundsB.x ? boundsB : boundsA

    const viewport = page.viewportSize()!
    const thirdW = Math.round(viewport.width / 3)
    expect(leftBounds.x).toBeLessThanOrEqual(5)
    expect(leftBounds.width).toBeGreaterThan(thirdW - 50)
    expect(leftBounds.width).toBeLessThan(thirdW + 50)
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
    await page.mouse.move(startX + 80, startY, { steps: 10 })
    await page.mouse.up()
    await waitForWindowBoundsStable(page, leftWindow)

    const newLeftBounds = await getWindowBounds(leftWindow)
    const newRightBounds = await getWindowBounds(rightWindow)

    expect(newLeftBounds.width).toBeGreaterThan(leftBounds.width)
    expect(newRightBounds.x).toBeGreaterThan(rightBounds.x)
  })

  test('snapping second window to right half fills remaining space after left is resized', async ({
    page,
  }) => {
    await gotoWorkspace(page)
    await openBrowserWindow(page)

    const groups = getWindowGroups(page)

    await dragToEdge(page, getDragHandle(groups.first()), 'left')

    const leftRnd = getRndWrapper(groups.first())
    const resizeHandle = leftRnd.locator('div[style*="col-resize"]').first()
    await expect(resizeHandle).toBeAttached()

    const handleBox = await resizeHandle.boundingBox()
    if (!handleBox) throw new Error('Resize handle not found')

    const startX = handleBox.x + handleBox.width / 2
    const startY = handleBox.y + handleBox.height / 2
    const viewport = page.viewportSize()!
    const halfW = Math.round(viewport.width / 2)
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(halfW - 150, startY, { steps: 10 })
    await page.mouse.up()
    await waitForWindowBoundsStable(page, groups.first())

    const resizedLeftBounds = await getWindowBounds(groups.first())
    const leftRightEdge = resizedLeftBounds.x + resizedLeftBounds.width

    await groups.nth(1).dispatchEvent('mousedown')
    await page.waitForTimeout(30)
    await dragToEdge(page, getDragHandle(groups.nth(1)), 'right')

    const boundsA = await getWindowBounds(groups.first())
    const boundsB = await getWindowBounds(groups.nth(1))
    const rightBounds = boundsA.x < boundsB.x ? boundsB : boundsA

    expect(rightBounds.x).toBeLessThanOrEqual(leftRightEdge + 5)
    expect(rightBounds.x).toBeGreaterThan(leftRightEdge - 5)
    expect(rightBounds.width).toBeGreaterThan(viewport.width - leftRightEdge - 10)
  })

  test('snapping second window to bottom quarter fills remaining space after top-left is resized', async ({
    page,
  }) => {
    await gotoWorkspace(page)
    await openBrowserWindow(page)

    const groups = getWindowGroups(page)

    await dragToEdge(page, getDragHandle(groups.first()), 'top-left')

    const topRnd = getRndWrapper(groups.first())
    const resizeHandle = topRnd.locator('div[style*="row-resize"]').first()
    await expect(resizeHandle).toBeAttached()

    const handleBox = await resizeHandle.boundingBox()
    if (!handleBox) throw new Error('Resize handle not found')

    const viewport = page.viewportSize()!
    const containerH = viewport.height - TASKBAR_HEIGHT
    const halfH = Math.round(containerH / 2)

    const startX = handleBox.x + handleBox.width / 2
    const startY = handleBox.y + handleBox.height / 2
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX, halfH - 80, { steps: 10 })
    await page.mouse.up()
    await waitForWindowBoundsStable(page, groups.first())

    const resizedTopBounds = await getWindowBounds(groups.first())
    const topBottomEdge = resizedTopBounds.y + resizedTopBounds.height

    await groups.nth(1).dispatchEvent('mousedown')
    await page.waitForTimeout(30)
    await dragToEdge(page, getDragHandle(groups.nth(1)), 'bottom-left')

    const boundsA = await getWindowBounds(groups.first())
    const boundsB = await getWindowBounds(groups.nth(1))
    const bottomBounds = boundsA.y < boundsB.y ? boundsB : boundsA

    expect(bottomBounds.y).toBeLessThanOrEqual(topBottomEdge + 5)
    expect(bottomBounds.y).toBeGreaterThan(topBottomEdge - 5)
    expect(bottomBounds.height).toBeGreaterThan(containerH - topBottomEdge - 10)
  })
})
