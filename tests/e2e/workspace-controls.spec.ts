import { test, expect, type BrowserContext, type Page, type Locator } from '@playwright/test'
import {
  TASKBAR_HEIGHT,
  gotoWorkspace,
  openBrowserWindow,
  getWindowGroups,
  getDragHandle,
  getWindowBounds,
  waitForWindowBoundsStable,
  dragFromTo,
  WORKSPACE_VISIBLE_WINDOW_GROUP,
} from '../e2e/workspace-layout-helpers'
import { createWorkspaceE2EContext } from './workspace-e2e-auth'

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

function getVisibleContent(windowGroup: Locator) {
  return windowGroup.locator('[data-testid="workspace-window-visible-content"]')
}

function workspaceTabs(tabStrip: Locator) {
  return tabStrip.locator('[data-workspace-tab-id]')
}

function getTaskbarCloseButtons(page: Page) {
  return page.locator('[data-taskbar-window-row] button[aria-label^="Close "]')
}

async function closeAllWindows(page: Page) {
  const closeBtns = getTaskbarCloseButtons(page)
  while ((await closeBtns.count()) > 0) {
    await closeBtns.first().click()
    await page.waitForTimeout(50)
  }
}

test.describe('Tab Merging and Splitting', () => {
  test('workspace tabs have borders on both sides', async () => {
    await gotoWorkspace(page)

    const tab = page.locator('.workspace-tab-strip [data-workspace-tab-id]')
    await expect(tab).toHaveCount(1)
    const borders = await tab.evaluate((el) => {
      const style = getComputedStyle(el)
      const titleBar = el.closest('[data-testid="window-drag-handle"]')?.parentElement
      const bottomGap = titleBar
        ? titleBar.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom
        : 0
      return {
        left: style.borderLeftWidth,
        right: style.borderRightWidth,
        bottomGap,
      }
    })

    expect(borders.left).toBe('1px')
    expect(borders.right).toBe('1px')
    expect(borders.bottomGap).toBeGreaterThan(0)
    expect(borders.bottomGap).toBeLessThanOrEqual(1)
  })

  test('merges window into another as tab', async () => {
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
      boxA.y + 16,
    )
    await waitForWindowBoundsStable(page, getWindowGroups(page).first())

    await expect(getWindowGroups(page)).toHaveCount(1)
    const tabStrip = page.locator('.workspace-tab-strip')
    await expect(tabStrip).toBeVisible()
  })

  test('splits tab into separate window', async () => {
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
      boxA.y + 16,
    )
    await waitForWindowBoundsStable(page, getWindowGroups(page).first())
    await expect(getWindowGroups(page)).toHaveCount(1)

    const tabStrip = page.locator('.workspace-tab-strip')
    const tabs = workspaceTabs(tabStrip)
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
    await waitForWindowBoundsStable(page, getWindowGroups(page).first())

    await expect(getWindowGroups(page)).toHaveCount(2)
  })

  test('detaching tab onto another tab bar merges in one gesture', async () => {
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
      boxA.y + 16,
    )
    await waitForWindowBoundsStable(page, getWindowGroups(page).first())
    await expect(getWindowGroups(page)).toHaveCount(1)

    const tabStrip = page.locator('.workspace-tab-strip')
    const tabs = workspaceTabs(tabStrip)
    const secondTab = tabs.nth(1)
    const tabBox = await secondTab.boundingBox()
    const firstGroup = getWindowGroups(page).first()
    const targetHandleBox = await getDragHandle(firstGroup).boundingBox()
    if (!tabBox || !targetHandleBox) throw new Error('Handles not visible')

    await dragFromTo(
      page,
      tabBox.x + tabBox.width * 0.7,
      tabBox.y + tabBox.height / 2,
      targetHandleBox.x + targetHandleBox.width / 2,
      targetHandleBox.y + 16,
    )
    await waitForWindowBoundsStable(page, getWindowGroups(page).first())

    await expect(getWindowGroups(page)).toHaveCount(1)
  })

  test('merge at slot inserts tab at chosen position', async () => {
    await gotoWorkspace(page)
    await openBrowserWindow(page)
    const groups = getWindowGroups(page)
    await expect(groups).toHaveCount(2)

    const groupA = groups.first()
    const firstSlot = groupA.locator('[data-tab-drop-slot]').first()
    await expect(firstSlot).toBeVisible()
    const slotBox = await firstSlot.boundingBox()
    const handleB = getDragHandle(groups.nth(1))
    const boxB = await handleB.boundingBox()
    if (!slotBox || !boxB) throw new Error('Handles not visible')

    await dragFromTo(
      page,
      boxB.x + boxB.width / 2,
      boxB.y + boxB.height / 2,
      slotBox.x + slotBox.width / 2,
      slotBox.y + slotBox.height / 2,
    )
    await waitForWindowBoundsStable(page, getWindowGroups(page).first())

    await expect(getWindowGroups(page)).toHaveCount(1)
    const tabStrip = page.locator('.workspace-tab-strip')
    const tabs = workspaceTabs(tabStrip)
    await expect(tabs.first()).toBeVisible()
  })

  test('shows correct tab count in taskbar after merge', async () => {
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
      boxA.y + 16,
    )
    await waitForWindowBoundsStable(page, getWindowGroups(page).first())

    const taskbarCloseBtn = getTaskbarCloseButtons(page)
    const label = await taskbarCloseBtn.first().getAttribute('aria-label')
    expect(label).toContain('+1')
  })

  test('taskbar shows title and icon of current tab, not first', async () => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    const content = getVisibleContent(groups.first())

    await content.getByText('Documents', { exact: true }).click()
    await page.waitForTimeout(150)
    await content.getByText('readme.txt').click()
    await page.waitForTimeout(150)

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
      boxA.y + 16,
    )
    await waitForWindowBoundsStable(page, getWindowGroups(page).first())

    await expect(getWindowGroups(page)).toHaveCount(1)
    const tabStrip = page.locator('.workspace-tab-strip')
    const tabs = workspaceTabs(tabStrip)
    await expect(tabs).toHaveCount(2)

    const getTaskbarLabel = () => getTaskbarCloseButtons(page).first().getAttribute('aria-label')

    const labelAfterMerge = await getTaskbarLabel()
    expect(labelAfterMerge).toContain('readme.txt')

    await tabs.first().click()
    await page.waitForTimeout(50)
    const labelAfterFirstTab = await getTaskbarLabel()
    expect(labelAfterFirstTab).not.toContain('readme.txt')

    await tabs.nth(1).click()
    await page.waitForTimeout(50)
    const labelAfterSecondTab = await getTaskbarLabel()
    expect(labelAfterSecondTab).toContain('readme.txt')
  })

  test('switching tabs changes active tab styling', async () => {
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
      boxA.y + 16,
    )
    await waitForWindowBoundsStable(page, getWindowGroups(page).first())

    const tabStrip = page.locator('.workspace-tab-strip')
    const tabs = workspaceTabs(tabStrip)
    await expect(tabs).toHaveCount(2)

    await tabs.first().click()
    await expect(tabs.first()).toHaveClass(/bg-background/)
  })

  test('closing one tab keeps the other', async () => {
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
      boxA.y + 16,
    )
    await waitForWindowBoundsStable(page, getWindowGroups(page).first())

    const tabStrip = page.locator('.workspace-tab-strip')
    const closeButtons = tabStrip.locator('button:has(.lucide-x)')
    await closeButtons.last().click()

    await expect(getWindowGroups(page)).toHaveCount(1)
  })

  test('closing second (active) tab returns to first tab content', async () => {
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
      boxA.y + 16,
    )
    await waitForWindowBoundsStable(page, getWindowGroups(page).first())

    await expect(getWindowGroups(page)).toHaveCount(1)
    const mergedWindow = getWindowGroups(page).first()
    const tabStrip = mergedWindow.locator('.workspace-tab-strip')
    const tabs = workspaceTabs(tabStrip)
    await expect(tabs).toHaveCount(2)

    await tabs.first().click()
    await page.waitForTimeout(50)
    const content = getVisibleContent(mergedWindow)
    await content.getByText('Documents', { exact: true }).click()
    await waitForWindowBoundsStable(page, getWindowGroups(page).first())
    await tabs.nth(1).click()
    await page.waitForTimeout(50)

    const closeButtons = tabStrip.locator('button:has(.lucide-x)')
    await closeButtons.nth(1).click()
    await page.waitForTimeout(150)

    await expect(getWindowGroups(page)).toHaveCount(1)
    const visibleContent = getVisibleContent(getWindowGroups(page).first())
    await expect(visibleContent.getByText('readme.txt')).toBeVisible({ timeout: 10000 })
  })

  test('closing window with multiple tabs closes all tabs', async () => {
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
      boxA.y + 16,
    )
    await waitForWindowBoundsStable(page, getWindowGroups(page).first())

    await expect(getWindowGroups(page)).toHaveCount(1)
    const tabStrip = page.locator('.workspace-tab-strip')
    await expect(tabStrip).toBeVisible()

    const windowCloseBtn = groups.first().locator('.workspace-window-buttons button:has(.lucide-x)')
    await windowCloseBtn.click()

    await expect(getWindowGroups(page)).toHaveCount(0)
  })
})

test.describe('Tab pin', () => {
  test('context menu pin hides close; unpin restores', async () => {
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
      boxA.y + 16,
    )
    await waitForWindowBoundsStable(page, getWindowGroups(page).first())
    await expect(getWindowGroups(page)).toHaveCount(1)

    const tabStrip = page.locator('.workspace-tab-strip')
    const tabs = workspaceTabs(tabStrip)
    await expect(tabs).toHaveCount(2)

    await tabs.first().click({ button: 'right' })
    await page.getByTestId('workspace-tab-menu-pin').click()
    await expect(tabs.first().getByTestId('workspace-tab-close')).toHaveCount(0)
    await expect(tabs.nth(1).getByTestId('workspace-tab-close')).toHaveCount(1)

    await tabs.first().click({ button: 'right' })
    await page.getByTestId('workspace-tab-menu-unpin').click()
    await expect(tabs.first().getByTestId('workspace-tab-close')).toHaveCount(1)
  })
})

test.describe('Taskbar', () => {
  test('shows empty state when no windows open', async () => {
    await gotoWorkspace(page)
    await closeAllWindows(page)
    await expect(page.getByText('No windows are open')).toBeVisible()
  })

  test('open browser control is visible and opens a second window', async () => {
    await gotoWorkspace(page)
    await test.step('shows Open browser window button', async () => {
      await expect(page.locator('button[title="Open browser window"]')).toBeVisible()
    })
    await test.step('opens a browser window from taskbar', async () => {
      await expect(getWindowGroups(page)).toHaveCount(1)
      await openBrowserWindow(page)
      await expect(getWindowGroups(page)).toHaveCount(2)
    })
  })

  test('clicking taskbar item focuses window', async () => {
    await gotoWorkspace(page)
    await openBrowserWindow(page)

    const rows = page.locator('[data-taskbar-window-row]')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(1)).toHaveAttribute('data-taskbar-active', '')
    await expect(rows.first()).not.toHaveAttribute('data-taskbar-active')

    await rows.first().locator('button').first().click()

    await expect(rows.first()).toHaveAttribute('data-taskbar-active', '')
    await expect(rows.nth(1)).not.toHaveAttribute('data-taskbar-active')
  })

  test('taskbar shows exactly one active row matching focused window', async () => {
    await gotoWorkspace(page)
    await expect(page.locator('[data-taskbar-window-row][data-taskbar-active]')).toHaveCount(1)

    await openBrowserWindow(page)
    await expect(page.locator('[data-taskbar-window-row][data-taskbar-active]')).toHaveCount(1)
    await expect(page.locator('[data-taskbar-window-row]')).toHaveCount(2)
  })

  test('clicking focused window in taskbar minimizes it', async () => {
    await gotoWorkspace(page)
    await expect(getWindowGroups(page)).toHaveCount(1)

    const firstTaskbarItem = page.locator('[data-taskbar-window-row]').first()
    await expect(firstTaskbarItem).toHaveAttribute('data-taskbar-active', '')
    await firstTaskbarItem.locator('button').first().click()

    await expect(getWindowGroups(page)).toHaveCount(0)
  })

  test('restores minimized window from taskbar', async () => {
    await gotoWorkspace(page)
    await expect(getWindowGroups(page)).toHaveCount(1)

    const groups = getWindowGroups(page)
    const minimizeBtn = groups.first().locator('button:has(.lucide-minus)')
    await minimizeBtn.click()
    await expect(getWindowGroups(page)).toHaveCount(0)

    const firstTaskbarItem = page.locator('[data-taskbar-window-row]').first()
    await firstTaskbarItem.locator('button').first().click()

    await expect(getWindowGroups(page)).toHaveCount(1)
  })

  test('restoring a minimized tab group keeps its active tab', async () => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    const content = getVisibleContent(groups.first())

    await content.getByText('Documents', { exact: true }).click()
    await content.getByText('readme.txt').click()
    await expect(groups).toHaveCount(2)

    const secondHandle = getDragHandle(groups.nth(1))
    const secondBox = await secondHandle.boundingBox()
    const firstBox = await getDragHandle(groups.first()).boundingBox()
    if (!secondBox || !firstBox) throw new Error('Handles not visible')

    await dragFromTo(
      page,
      secondBox.x + secondBox.width / 2,
      secondBox.y + secondBox.height / 2,
      firstBox.x + firstBox.width / 2,
      firstBox.y + 16,
    )
    await waitForWindowBoundsStable(page, groups.first())

    await expect(groups).toHaveCount(1)
    const tabs = workspaceTabs(page.locator('.workspace-tab-strip'))
    await expect(tabs).toHaveCount(2)
    await expect(tabs.nth(1)).toHaveClass(/bg-background/)

    await groups.first().getByRole('button', { name: 'Minimize' }).click()
    await expect(groups).toHaveCount(0)
    await page.locator('[data-taskbar-window-row]').first().locator('button').first().click()

    await expect(groups).toHaveCount(1)
    await expect(tabs.nth(1)).toHaveClass(/bg-background/)
    await expect(getVisibleContent(groups.first())).toContainText('This is a test readme file.')
  })

  test('minimizing focused window focuses the next window', async () => {
    await gotoWorkspace(page)
    await openBrowserWindow(page)
    await expect(getWindowGroups(page)).toHaveCount(2)

    const firstTaskbarItem = page.locator('[data-taskbar-window-row]').first()
    await firstTaskbarItem.locator('button').first().click()
    await page.waitForTimeout(50)

    const groups = getWindowGroups(page)
    const firstContent = getVisibleContent(groups.first())
    await firstContent.getByText('Documents', { exact: true }).click()
    await waitForWindowBoundsStable(page, getWindowGroups(page).first())

    const secondTaskbarItem = page.locator('[data-taskbar-window-row]').nth(1)
    await secondTaskbarItem.locator('button').first().click()
    await page.waitForTimeout(50)

    const secondGroup = groups.nth(1)
    const minimizeBtn = secondGroup.locator('button:has(.lucide-minus)')
    await minimizeBtn.click()

    await expect(getWindowGroups(page)).toHaveCount(1)
    await expect(getVisibleContent(groups.first())).toContainText('Documents')
    const activeTaskbar = page.locator('[data-taskbar-window-row][data-taskbar-active]')
    await expect(activeTaskbar).toHaveCount(1)
    await expect(activeTaskbar).toContainText('Documents')
    await expect(page.locator('[data-taskbar-window-row]:not([data-taskbar-active])')).toHaveCount(
      1,
    )
  })

  test('closes window from taskbar', async () => {
    await gotoWorkspace(page)
    await expect(getWindowGroups(page)).toHaveCount(1)

    const taskbarCloseBtn = getTaskbarCloseButtons(page)
    await taskbarCloseBtn.first().click()

    await expect(getWindowGroups(page)).toHaveCount(0)
  })
})

test.describe('Window Buttons', () => {
  test('minimize button hides window', async () => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    await expect(groups).toHaveCount(1)

    const minimizeBtn = groups.first().locator('button:has(.lucide-minus)')
    await minimizeBtn.click()

    await expect(getWindowGroups(page)).toHaveCount(0)
  })

  test('maximize expands to fullscreen then restores with bounds', async () => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    const preBounds = await getWindowBounds(groups.first())
    await expect(groups.first()).toHaveCSS('border-radius', '10px')
    await expect(groups.first()).toHaveCSS('outline-style', 'solid')

    await test.step('expands to fullscreen', async () => {
      const maximizeBtn = groups.first().locator('button:has(.lucide-maximize-2)')
      await maximizeBtn.click()
      await page.waitForTimeout(50)
      const bounds = await getWindowBounds(groups.first())
      const viewport = page.viewportSize()!
      const containerH = viewport.height - TASKBAR_HEIGHT
      expect(bounds.width).toBeGreaterThan(viewport.width - 10)
      expect(bounds.height).toBeGreaterThan(containerH - 10)
      await expect(groups.first()).toHaveCSS('border-radius', '0px')
      await expect(groups.first()).toHaveCSS('outline-style', 'none')
    })

    await test.step('restores from fullscreen', async () => {
      const restoreBtn = groups.first().locator('button:has(.lucide-minimize-2)')
      await restoreBtn.click()
      await page.waitForTimeout(50)
      const restoredBounds = await getWindowBounds(groups.first())
      const viewport = page.viewportSize()!
      expect(restoredBounds.width).toBeLessThan(viewport.width - 50)
      expect(restoredBounds.height).toBeLessThan(viewport.height - 50)
      expect(restoredBounds.width).toBeGreaterThan(preBounds.width - 20)
      expect(restoredBounds.width).toBeLessThan(preBounds.width + 20)
      await expect(groups.first()).toHaveCSS('border-radius', '10px')
      await expect(groups.first()).toHaveCSS('outline-style', 'solid')
    })
  })

  test('close button removes window', async () => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    await expect(groups).toHaveCount(1)

    const closeBtn = groups.first().locator('.workspace-window-buttons button:has(.lucide-x)')
    await closeBtn.click()

    await expect(getWindowGroups(page)).toHaveCount(0)
  })

  test('close button on window with multiple tabs closes all tabs', async () => {
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
      boxA.y + 16,
    )
    await waitForWindowBoundsStable(page, getWindowGroups(page).first())
    await expect(getWindowGroups(page)).toHaveCount(1)

    const closeBtn = groups.first().locator('.workspace-window-buttons button:has(.lucide-x)')
    await closeBtn.click()

    await expect(getWindowGroups(page)).toHaveCount(0)
  })

  test('maximize button expands window to fill workspace', async () => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    const maximizeBtn = groups.first().locator('button:has(.lucide-maximize-2)')

    await test.step('maximize fills workspace', async () => {
      await maximizeBtn.click()
      await page.waitForTimeout(50)
      const bounds = await getWindowBounds(groups.first())
      const viewport = page.viewportSize()!
      const containerH = viewport.height - TASKBAR_HEIGHT
      expect(bounds.width).toBeGreaterThan(viewport.width - 10)
      expect(bounds.height).toBeGreaterThan(containerH - 10)
    })
  })
})

test.describe('File Browsing and Viewers', () => {
  test('workspace browser shows root folders and can open a folder', async () => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    const content = getVisibleContent(groups.first())

    await test.step('shows root folders', async () => {
      await Promise.all(
        ['Videos', 'Music', 'Images', 'Documents'].map((folder) =>
          expect(content.getByText(folder, { exact: true })).toBeVisible(),
        ),
      )
    })

    await test.step('navigating into a folder updates browser content', async () => {
      await content.getByText('Videos', { exact: true }).click()
      await expect(content.getByText('sample.mp4')).toBeVisible({ timeout: 10000 })
    })
  })

  test('clicking a text file opens a viewer window', async () => {
    await gotoWorkspace(page)

    const groups = getWindowGroups(page)
    const content = getVisibleContent(groups.first())

    await content.getByText('Documents', { exact: true }).click()
    await expect(content.getByText('readme.txt')).toBeVisible()

    await content.getByText('readme.txt').click()

    await expect(getWindowGroups(page)).toHaveCount(2)
  })

  test('clicking an image opens an image viewer window', async () => {
    await gotoWorkspace(page)

    const groups = getWindowGroups(page)
    const content = getVisibleContent(groups.first())

    await content.getByText('Images', { exact: true }).click()
    await expect(content.getByText('photo.jpg')).toBeVisible()

    await content.getByText('photo.jpg').click()

    await expect(getWindowGroups(page)).toHaveCount(2)
  })

  test('"Open in new tab" for folder opens in same window as new tab', async () => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    const content = getVisibleContent(groups.first())

    await content.getByText('Videos', { exact: true }).click({ button: 'right' })
    await page.locator('[data-slot="context-menu-item"]').getByText('Open in new tab').click()

    await expect(getWindowGroups(page)).toHaveCount(1)
    await expect(content.getByText('sample.mp4')).toBeVisible({ timeout: 10000 })
  })

  test('"Open in new tab" for file opens in same window as new tab', async () => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    const content = getVisibleContent(groups.first())

    await content.getByText('Documents', { exact: true }).click()
    await expect(content.getByText('readme.txt')).toBeVisible()

    await content.locator('tr').filter({ hasText: 'readme.txt' }).click({ button: 'right' })
    await page.locator('[data-slot="context-menu-item"]').getByText('Open in new tab').click()

    await expect(getWindowGroups(page)).toHaveCount(1)
    await expect(content).toContainText('readme')
  })
})

test.describe('Player Window Reuse', () => {
  test('video player window is created once and reused for same file', async () => {
    await gotoWorkspace(page)
    const groups = getWindowGroups(page)
    const content = getVisibleContent(groups.first())

    await test.step('playing a video creates a player window', async () => {
      await content.getByText('Videos', { exact: true }).click()
      await expect(content.getByText('sample.mp4')).toBeVisible()
      await content.getByText('sample.mp4').click()
      const videos = page.locator(`${WORKSPACE_VISIBLE_WINDOW_GROUP} video`)
      await expect(videos).toHaveCount(1)
    })

    await test.step('playing the same video again reuses the player window', async () => {
      const windowCountAfterFirst = await getWindowGroups(page).count()
      const browserContent = getVisibleContent(groups.first())
      await browserContent.getByText('sample.mp4').click({ force: true })
      await expect(page.locator(`${WORKSPACE_VISIBLE_WINDOW_GROUP} video`)).toHaveCount(1)
      const windowCountAfterSecond = await getWindowGroups(page).count()
      expect(windowCountAfterSecond).toBe(windowCountAfterFirst)
    })
  })
})
