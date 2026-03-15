import { test, expect, type Page, type Locator } from '@playwright/test'

const TASKBAR_HEIGHT = 32

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

function getDragHandle(windowGroup: Locator) {
  return windowGroup.locator('[data-testid="window-drag-handle"]')
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

async function dragToEdge(page: Page, handle: Locator, target: 'left' | 'right') {
  const viewport = page.viewportSize()!
  const box = await handle.boundingBox()
  if (!box) throw new Error('Handle not visible')

  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  const containerHeight = viewport.height - TASKBAR_HEIGHT
  const endX = target === 'left' ? 5 : viewport.width - 5
  const endY = containerHeight / 2

  await dragFromTo(page, startX, startY, endX, endY)
  await page.waitForTimeout(100)
}

async function navigateToSharedContent(content: Locator) {
  await content.getByText('SharedContent', { exact: true }).click()
  await expect(content.getByText('public-doc.txt')).toBeVisible({ timeout: 5_000 })
}

async function createTempFile(page: Page, content: Locator, fileName: string) {
  await content.locator('button[title="Create new file"]').click()
  const dialog = page.locator('[role="dialog"]')
  await dialog.locator('input[placeholder*="File name"]').fill(fileName)
  await dialog.getByRole('button', { name: 'Create' }).click()
  await dialog.waitFor({ state: 'hidden' })
  await expect(content.getByText(fileName)).toBeVisible({ timeout: 5_000 })
}

async function deleteFileViaContextMenu(page: Page, content: Locator, fileName: string) {
  await content.locator('tr').filter({ hasText: fileName }).click({ button: 'right' })
  await page.locator('[data-slot="context-menu-item"]').getByText('Delete').click()
  await page.getByRole('button', { name: /Delete/i }).click()
  await expect(content.getByText(fileName)).not.toBeVisible({ timeout: 5_000 })
}

/**
 * Dispatch a full HTML5 DnD sequence using element handles for precise targeting.
 * Playwright's built-in dragTo doesn't reliably carry custom DataTransfer MIME data.
 */
async function html5DragDrop(source: Locator, target: Locator) {
  const srcHandle = await source.elementHandle()
  const tgtHandle = await target.elementHandle()
  if (!srcHandle || !tgtHandle) throw new Error('Element handles not found')

  await source.page().evaluate(
    ([src, tgt]) => {
      const dt = new DataTransfer()
      src!.dispatchEvent(
        new DragEvent('dragstart', { dataTransfer: dt, bubbles: true, cancelable: true }),
      )
      tgt!.dispatchEvent(
        new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }),
      )
      tgt!.dispatchEvent(
        new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }),
      )
      tgt!.dispatchEvent(
        new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }),
      )
      src!.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }))
    },
    [srcHandle, tgtHandle],
  )
}

test.describe('Cross-Window File Move', () => {
  test('drags a file from one browser into a folder in another', async ({ page }) => {
    await gotoWorkspace(page)
    await openBrowserWindow(page)

    const groups = getWindowGroups(page)
    await dragToEdge(page, getDragHandle(groups.first()), 'left')
    await groups.nth(1).dispatchEvent('mousedown')
    await page.waitForTimeout(50)
    await dragToEdge(page, getDragHandle(groups.nth(1)), 'right')

    const contentA = groups.first().locator('.workspace-window-content')
    const contentB = groups.nth(1).locator('.workspace-window-content')

    await navigateToSharedContent(contentA)
    await navigateToSharedContent(contentB)

    const tempFile = 'cross-dnd-test.txt'
    await createTempFile(page, contentA, tempFile)

    const sourceRow = contentA.locator('tr').filter({ hasText: tempFile })
    const targetRow = contentB.locator('tr').filter({ hasText: 'subfolder' }).first()

    await html5DragDrop(sourceRow, targetRow)

    await expect(contentA.getByText(tempFile)).not.toBeVisible({ timeout: 5_000 })

    await contentB.getByText('subfolder').first().click()
    await expect(contentB.getByText(tempFile)).toBeVisible({ timeout: 5_000 })

    await deleteFileViaContextMenu(page, contentB, tempFile)
  })

  test('non-editable files are not draggable', async ({ page }) => {
    await gotoWorkspace(page)

    const groups = getWindowGroups(page)
    const content = groups.first().locator('.workspace-window-content')

    await content.getByText('Documents', { exact: true }).click()
    await expect(content.getByText('readme.txt')).toBeVisible({ timeout: 5_000 })

    const readmeRow = content.locator('tr').filter({ hasText: 'readme.txt' })
    const draggable = await readmeRow.getAttribute('draggable')

    expect(draggable).not.toBe('true')
  })
})

test.describe('Drop File onto Tab Bar', () => {
  test('dropping a folder onto the tab bar opens it as a new browser tab', async ({ page }) => {
    await gotoWorkspace(page)
    await openBrowserWindow(page)

    const groups = getWindowGroups(page)
    await dragToEdge(page, getDragHandle(groups.first()), 'left')
    await groups.nth(1).dispatchEvent('mousedown')
    await page.waitForTimeout(50)
    await dragToEdge(page, getDragHandle(groups.nth(1)), 'right')

    const contentA = groups.first().locator('.workspace-window-content')
    await navigateToSharedContent(contentA)

    const folderRow = contentA.locator('tr').filter({ hasText: 'subfolder' }).first()
    const headerB = groups.nth(1).locator('[data-tab-drop-target]')

    await html5DragDrop(folderRow, headerB)
    await page.waitForTimeout(300)

    const tabStrip = groups.nth(1).locator('.workspace-tab-strip')
    await expect(tabStrip).toBeVisible({ timeout: 5_000 })
  })

  test('dropping a file onto the tab bar opens a viewer tab', async ({ page }) => {
    await gotoWorkspace(page)
    await openBrowserWindow(page)

    const groups = getWindowGroups(page)
    await dragToEdge(page, getDragHandle(groups.first()), 'left')
    await groups.nth(1).dispatchEvent('mousedown')
    await page.waitForTimeout(50)
    await dragToEdge(page, getDragHandle(groups.nth(1)), 'right')

    const contentA = groups.first().locator('.workspace-window-content')
    await navigateToSharedContent(contentA)

    const fileRow = contentA.locator('tr').filter({ hasText: 'public-doc.txt' })
    const headerB = groups.nth(1).locator('[data-tab-drop-target]')

    await html5DragDrop(fileRow, headerB)
    await page.waitForTimeout(300)

    const tabStrip = groups.nth(1).locator('.workspace-tab-strip')
    await expect(tabStrip).toBeVisible({ timeout: 5_000 })
  })
})

test.describe('Window Merge Still Works', () => {
  test('dragging window title bar onto another still merges them', async ({ page }) => {
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
})
