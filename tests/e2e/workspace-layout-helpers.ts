import type { Page, Locator } from '@playwright/test'
import { expect } from '@playwright/test'

export const TASKBAR_HEIGHT = 32

export async function gotoWorkspace(page: Page) {
  await page.goto('/workspace')
  await expect(page.locator('[data-window-group]')).toBeVisible()
}

export async function openBrowserWindow(page: Page) {
  const countBefore = await page.locator('[data-window-group]').count()
  await page.locator('button[title="Open browser window"]').click()
  await expect(page.locator('[data-window-group]')).toHaveCount(countBefore + 1)
}

export function getWindowGroups(page: Page) {
  return page.locator('[data-window-group]')
}

export function getRndWrapper(windowGroup: Locator) {
  return windowGroup.locator('..')
}

/** Rightmost vertical resize handle (shared column edge), not the outer screen edge. */
export async function getSharedColumnResizeHandle(windowGroup: Locator): Promise<Locator> {
  const rnd = getRndWrapper(windowGroup)
  const handles = rnd.locator('div[style*="col-resize"]')
  const count = await handles.count()
  if (count === 0) throw new Error('No col-resize handle on window')
  let bestIdx = 0
  let bestCx = -Infinity
  for (let i = 0; i < count; i++) {
    const box = await handles.nth(i).boundingBox()
    if (!box) continue
    const cx = box.x + box.width / 2
    if (cx > bestCx) {
      bestCx = cx
      bestIdx = i
    }
  }
  return handles.nth(bestIdx)
}

export function getDragHandle(windowGroup: Locator) {
  return windowGroup.locator('[data-testid="window-drag-handle"]')
}

export async function getWindowBounds(windowGroup: Locator) {
  const rnd = getRndWrapper(windowGroup)
  const box = await rnd.boundingBox()
  return box!
}

/** Wait for window bounds to stabilize after drag/resize (replaces fixed timeouts). */
export async function waitForWindowBoundsStable(page: Page, windowGroup: Locator, timeoutMs = 400) {
  const deadline = Date.now() + timeoutMs
  let prev: string | null = null
  /* eslint-disable no-await-in-loop -- poll until bounds stabilize */
  while (Date.now() < deadline) {
    const b = await getWindowBounds(windowGroup)
    const key = `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)},${Math.round(b.height)}`
    if (prev === key) return
    prev = key
    await page.waitForTimeout(25)
  }
  /* eslint-enable no-await-in-loop */
}

export async function dragFromTo(
  page: Page,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  steps = 10,
) {
  await page.mouse.move(fromX, fromY)
  await page.mouse.down()
  await page.mouse.move(toX, toY, { steps })
  await page.mouse.up()
}

export async function dragToEdge(
  page: Page,
  handle: Locator,
  target:
    | 'left'
    | 'right'
    | 'top'
    | 'top-left'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-right'
    | 'top-half'
    | 'bottom-half',
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
    case 'top-half':
      endX = viewport.width * 0.2
      endY = 5
      break
    case 'bottom-half':
      endX = viewport.width / 2
      endY = containerHeight - 5
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
  await page.waitForTimeout(100)
}
