import { test, expect, type Page, type Locator } from '@playwright/test'

const TASKBAR_HEIGHT = 44

async function gotoWorkspace(page: Page) {
  await page.goto('/workspace')
  await expect(page.locator('[data-window-group]')).toBeVisible()
}

async function openBrowserWindow(page: Page) {
  const countBefore = await page.locator('[data-window-group]').count()
  await page.locator('button[title="Open browser window"]').click()
  await expect(page.locator('[data-window-group]')).toHaveCount(countBefore + 1)
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
  steps = 10,
) {
  await page.mouse.move(fromX, fromY)
  await page.mouse.down()
  await page.mouse.move(toX, toY, { steps })
  await page.mouse.up()
}

async function closeAllWindows(page: Page) {
  const closeBtns = page.locator('button[aria-label^="Close "]')
  while ((await closeBtns.count()) > 0) {
    await closeBtns.first().click()
    await page.waitForTimeout(100)
  }
}

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
    await page.waitForTimeout(200)

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
    await page.waitForTimeout(200)
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
    await page.waitForTimeout(200)

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
    await page.waitForTimeout(200)

    const taskbarCloseBtn = page.locator('button[aria-label^="Close "]')
    const label = await taskbarCloseBtn.first().getAttribute('aria-label')
    expect(label).toContain('+1')
  })

  test('taskbar shows title and icon of current tab, not first', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    const content = groups.first().locator('.workspace-window-content')

    await content.getByText('Documents', { exact: true }).click()
    await page.waitForTimeout(300)
    await content.getByText('readme.txt').click()
    await page.waitForTimeout(300)

    await expect(getWindowGroups(page)).toHaveCount(2)

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
    await page.waitForTimeout(200)

    await expect(getWindowGroups(page)).toHaveCount(1)
    const tabStrip = page.locator('.workspace-tab-strip')
    const tabs = tabStrip
      .locator('[data-no-window-drag]')
      .filter({ hasNotText: '◂' })
      .filter({ hasNotText: '▸' })
    await expect(tabs).toHaveCount(2)

    const getTaskbarLabel = () =>
      page.locator('button[aria-label^="Close "]').first().getAttribute('aria-label')

    const labelAfterMerge = await getTaskbarLabel()
    expect(labelAfterMerge).toContain('readme.txt')

    await tabs.first().click()
    await page.waitForTimeout(100)
    const labelAfterFirstTab = await getTaskbarLabel()
    expect(labelAfterFirstTab).not.toContain('readme.txt')

    await tabs.nth(1).click()
    await page.waitForTimeout(100)
    const labelAfterSecondTab = await getTaskbarLabel()
    expect(labelAfterSecondTab).toContain('readme.txt')
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
    await page.waitForTimeout(200)

    const tabStrip = page.locator('.workspace-tab-strip')
    const tabs = tabStrip
      .locator('[data-no-window-drag]')
      .filter({ hasNotText: '◂' })
      .filter({ hasNotText: '▸' })
    await expect(tabs).toHaveCount(2)

    await tabs.first().click()
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
    await page.waitForTimeout(200)

    const tabStrip = page.locator('.workspace-tab-strip')
    const closeButtons = tabStrip.locator('button:has(.lucide-x)')
    await closeButtons.last().click()

    await expect(getWindowGroups(page)).toHaveCount(1)
  })

  test('closing window with multiple tabs closes all tabs', async ({ page }) => {
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
    await page.waitForTimeout(200)

    await expect(getWindowGroups(page)).toHaveCount(1)
    const tabStrip = page.locator('.workspace-tab-strip')
    await expect(tabStrip).toBeVisible()

    const windowCloseBtn = groups.first().locator('.workspace-window-buttons button:has(.lucide-x)')
    await windowCloseBtn.click()

    await expect(getWindowGroups(page)).toHaveCount(0)
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

    await expect(firstTaskbarItem).toHaveClass(/bg-white\/10/)
  })

  test('restores minimized window from taskbar', async ({ page }) => {
    await gotoWorkspace(page)
    await expect(getWindowGroups(page)).toHaveCount(1)

    const groups = getWindowGroups(page)
    const minimizeBtn = groups.first().locator('button:has(.lucide-minus)')
    await minimizeBtn.click()
    await expect(getWindowGroups(page)).toHaveCount(0)

    const taskbarCloseButtons = page.locator('button[aria-label^="Close "]')
    const firstTaskbarItem = taskbarCloseButtons.first().locator('..')
    await firstTaskbarItem.locator('button').first().click()

    await expect(getWindowGroups(page)).toHaveCount(1)
  })

  test('closes window from taskbar', async ({ page }) => {
    await gotoWorkspace(page)
    await expect(getWindowGroups(page)).toHaveCount(1)

    const taskbarCloseBtn = page.locator('button[aria-label^="Close "]')
    await taskbarCloseBtn.first().click()

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

    await expect(getWindowGroups(page)).toHaveCount(0)
  })

  test('maximize button expands to fullscreen', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)

    const maximizeBtn = groups.first().locator('button:has(.lucide-maximize-2)')
    await maximizeBtn.click()
    await page.waitForTimeout(100)

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
    await page.waitForTimeout(100)

    const restoreBtn = groups.first().locator('button:has(.lucide-minimize-2)')
    await restoreBtn.click()
    await page.waitForTimeout(100)

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

    const closeBtn = groups.first().locator('.workspace-window-buttons button:has(.lucide-x)')
    await closeBtn.click()

    await expect(getWindowGroups(page)).toHaveCount(0)
  })

  test('close button on window with multiple tabs closes all tabs', async ({ page }) => {
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
    await page.waitForTimeout(200)
    await expect(getWindowGroups(page)).toHaveCount(1)

    const closeBtn = groups.first().locator('.workspace-window-buttons button:has(.lucide-x)')
    await closeBtn.click()

    await expect(getWindowGroups(page)).toHaveCount(0)
  })

  test('add tab button adds a new tab', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)

    const addTabBtn = groups.first().locator('button:has(.lucide-plus)')
    await addTabBtn.click()

    const tabStrip = page.locator('.workspace-tab-strip')
    await expect(tabStrip).toBeVisible()
  })

  test('right-click maximize opens layout picker', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)

    const maximizeBtn = groups.first().locator('button:has(.lucide-maximize-2)')
    await maximizeBtn.click({ button: 'right' })

    await expect(page.getByText('Snap layout')).toBeVisible()
  })

  test('selecting a layout from picker snaps window', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)

    const maximizeBtn = groups.first().locator('button:has(.lucide-maximize-2)')
    await maximizeBtn.click({ button: 'right' })
    await expect(page.getByText('Snap layout')).toBeVisible()

    const pickerSlots = page.locator('.grid.h-12.w-16 button')
    await pickerSlots.first().click()
    await page.waitForTimeout(100)

    const bounds = await getWindowBounds(groups.first())
    const viewport = page.viewportSize()!
    const containerH = viewport.height - TASKBAR_HEIGHT

    expect(bounds.width).toBeGreaterThan(viewport.width - 10)
    expect(bounds.height).toBeGreaterThan(containerH - 10)
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

    await expect(content.getByText('sample.mp4')).toBeVisible({ timeout: 10000 })
  })

  test('clicking a text file opens a viewer window', async ({ page }) => {
    await gotoWorkspace(page)

    const groups = getWindowGroups(page)
    const content = groups.first().locator('.workspace-window-content')

    await content.getByText('Documents', { exact: true }).click()
    await expect(content.getByText('readme.txt')).toBeVisible()

    await content.getByText('readme.txt').click()

    await expect(getWindowGroups(page)).toHaveCount(2)
  })

  test('clicking an image opens an image viewer window', async ({ page }) => {
    await gotoWorkspace(page)

    const groups = getWindowGroups(page)
    const content = groups.first().locator('.workspace-window-content')

    await content.getByText('Images', { exact: true }).click()
    await expect(content.getByText('photo.jpg')).toBeVisible()

    await content.getByText('photo.jpg').click()

    await expect(getWindowGroups(page)).toHaveCount(2)
  })

  test('"Open in new tab" for folder opens in same window as new tab', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    const content = groups.first().locator('.workspace-window-content')

    await content.getByText('Videos', { exact: true }).click({ button: 'right' })
    await page.locator('[data-slot="context-menu-item"]').getByText('Open in new tab').click()

    await expect(getWindowGroups(page)).toHaveCount(1)
    await expect(content.getByText('sample.mp4')).toBeVisible({ timeout: 10000 })
  })

  test('"Open in new tab" for file opens in same window as new tab', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    const content = groups.first().locator('.workspace-window-content')

    await content.getByText('Documents', { exact: true }).click()
    await expect(content.getByText('readme.txt')).toBeVisible()

    await content.locator('tr').filter({ hasText: 'readme.txt' }).click({ button: 'right' })
    await page.locator('[data-slot="context-menu-item"]').getByText('Open in new tab').click()

    await expect(getWindowGroups(page)).toHaveCount(1)
    await expect(content).toContainText('readme')
  })
})

test.describe('Player Window Reuse', () => {
  test('playing a video creates a player window', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    const content = groups.first().locator('.workspace-window-content')

    await content.getByText('Videos', { exact: true }).click()
    await expect(content.getByText('sample.mp4')).toBeVisible()
    await content.getByText('sample.mp4').click()

    const videos = page.locator('[data-window-group] video')
    await expect(videos).toHaveCount(1)
  })

  test('playing the same video again reuses the player window', async ({ page }) => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    const content = groups.first().locator('.workspace-window-content')

    await content.getByText('Videos', { exact: true }).click()
    await expect(content.getByText('sample.mp4')).toBeVisible()
    await content.getByText('sample.mp4').click()

    const videos = page.locator('[data-window-group] video')
    await expect(videos).toHaveCount(1)
    const windowCountAfterFirst = await getWindowGroups(page).count()

    const browserContent = groups.first().locator('.workspace-window-content')
    await browserContent.getByText('sample.mp4').click()

    await expect(page.locator('[data-window-group] video')).toHaveCount(1)
    const windowCountAfterSecond = await getWindowGroups(page).count()
    expect(windowCountAfterSecond).toBe(windowCountAfterFirst)
  })
})
