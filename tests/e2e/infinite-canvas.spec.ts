import { expect, test } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const batchId = process.env.BATCH_ID
const mediaDirName = batchId ? `test-media-${batchId}` : 'test-media'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('canvas-test-initialized')) return
    sessionStorage.setItem('canvas-test-initialized', '1')
    localStorage.removeItem('infinite-canvas-state-v1')
    localStorage.setItem('workspace-state-test-sentinel', 'untouched')
  })
  await page.goto('/canvas')
  await expect(page.getByTestId('infinite-canvas')).toBeVisible()
})

test('creates and locally restores isolated frames and windows', async ({ page }) => {
  await page.getByTestId('infinite-canvas').click({ button: 'right', position: { x: 160, y: 140 } })
  await page.getByRole('button', { name: 'New frame' }).click()
  await page.getByLabel('Name').fill('Media Server')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('canvas-frame')).toHaveCount(1)
  await expect(page.getByTestId('canvas-frame')).toContainText('Media Server')
  await expect(page.getByTestId('canvas-frame')).not.toHaveClass(/ring-/)
  await expect(page.getByTestId('canvas-frame').locator('[data-canvas-resize]')).toHaveCount(8)
  const frameChrome = await page.getByTestId('canvas-frame').evaluate((element) => ({
    borderWidth: getComputedStyle(element).borderTopWidth,
    radius: getComputedStyle(element).borderTopLeftRadius,
  }))
  expect(frameChrome).toEqual({ borderWidth: '1px', radius: '10px' })
  await expect(page.getByTestId('canvas-frame-header')).toHaveCSS('height', '32px')
  await page.getByTestId('canvas-frame').click({ position: { x: 100, y: 100 } })
  await expect(page.locator('header')).not.toContainText('Media Server')

  await page.getByTestId('infinite-canvas').click({ button: 'right', position: { x: 32, y: 650 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()
  await expect(page.getByTestId('canvas-window')).toHaveCount(1)

  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = localStorage.getItem('infinite-canvas-state-v1')
        if (!raw) return null
        const state = JSON.parse(raw) as { frames?: unknown[]; windows?: unknown[] }
        return [state.frames?.length ?? 0, state.windows?.length ?? 0]
      }),
    )
    .toEqual([1, 1])
  await page.reload()
  await expect(page.getByTestId('canvas-frame')).toHaveCount(1)
  await expect(page.getByTestId('canvas-window')).toHaveCount(1)
  expect(await page.evaluate(() => localStorage.getItem('workspace-state-test-sentinel'))).toBe(
    'untouched',
  )
})

test('keeps clicked frame as breadcrumb root', async ({ page }) => {
  const canvas = page.getByTestId('infinite-canvas')
  await canvas.click({ button: 'right', position: { x: 700, y: 400 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()

  await canvas.click({ button: 'right', position: { x: 100, y: 100 } })
  await page.getByRole('button', { name: 'New frame' }).click()
  await page.getByLabel('Name').fill('Breadcrumb project')
  await page.getByRole('button', { name: 'Save' }).click()

  await expect(page.getByTestId('canvas-frame')).toHaveCount(1)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = localStorage.getItem('infinite-canvas-state-v1')
        if (!raw) return null
        const state = JSON.parse(raw)
        return [state.frames?.length, state.windows?.length]
      }),
    )
    .toEqual([1, 1])
  await page.evaluate(() => {
    const key = 'infinite-canvas-state-v1'
    const state = JSON.parse(localStorage.getItem(key)!)
    const frame = state.frames[0]
    const window = state.windows[0]
    window.bounds.x -= frame.bounds.x
    window.bounds.y -= frame.bounds.y
    window.frameId = frame.id
    localStorage.setItem(key, JSON.stringify(state))
  })
  await page.reload()
  await page.getByTestId('canvas-window').click({ position: { x: 20, y: 20 } })

  await expect(page.getByTestId('canvas-frame-breadcrumb')).toHaveText('Breadcrumb project')
  await expect(page.getByTestId('canvas-window-breadcrumb')).toBeVisible()
  await page.getByTestId('canvas-frame-breadcrumb').click()
  await expect(page.getByTestId('canvas-frame-breadcrumb')).toHaveText('Breadcrumb project')
  await expect(page.getByTestId('canvas-window-breadcrumb')).toHaveCount(0)
})

test('opens unified search with Ctrl+P and overrides print', async ({ page }) => {
  await page.keyboard.press('Control+P')
  const palette = page.getByTestId('canvas-search-palette')
  await expect(palette).toBeVisible()
  await expect(page.getByPlaceholder('Search windows, frames, files and folders…')).toBeFocused()
  const box = await palette.boundingBox()
  if (!box) throw new Error('Canvas search palette not laid out')
  expect(box.height).toBeLessThan(360)
  expect(box.width).toBeLessThanOrEqual(680)
})

test('keeps populated search compact on tall displays', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1800 })
  await page.route('**/api/files/search?*', async (route) => {
    await route.fulfill({
      json: {
        results: Array.from({ length: 40 }, (_, index) => ({
          name: `media-${index}.md`,
          path: `Notes/media-${index}.md`,
          parentPath: 'Notes',
          rootId: 'media',
          rootName: 'Media',
          isDirectory: false,
          extension: 'md',
          type: 'text',
        })),
        truncated: false,
        status: {
          state: 'ready',
          stale: false,
          indexedEntries: 40,
          scannedDirectories: 1,
          watcherCount: 1,
          roots: [],
        },
      },
    })
  })
  await page.keyboard.press('Control+P')
  await page.getByTestId('canvas-search-palette').locator('input').fill('media')
  await expect(page.getByText('media-39.md')).toBeAttached()
  await expect(page.locator('[data-search-result-path="Notes/media-0.md"] svg')).toHaveClass(
    /text-cyan-500/,
  )
  const box = await page.getByTestId('canvas-search-palette').boundingBox()
  if (!box) throw new Error('Populated canvas search palette not laid out')
  expect(box.height).toBeLessThanOrEqual(482)
})

test('zooms around cursor and resets zoom from toolbar', async ({ page }) => {
  const canvas = page.getByTestId('infinite-canvas')
  const before = await page.getByTitle('Reset zoom').textContent()
  await expect(page.getByTitle('Zoom in')).toBeDisabled()
  await canvas.hover({ position: { x: 400, y: 300 } })
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, 300)
  await page.keyboard.up('Control')
  await expect.poll(() => page.getByTitle('Reset zoom').textContent()).not.toBe(before)
  await page.getByTitle('Reset zoom').click()
  await expect(page.getByTitle('Reset zoom')).toHaveText('100%')
  await expect(page.getByTitle('Zoom in')).toBeDisabled()
})

test('preserves window shape across semantic zoom levels', async ({ page }) => {
  const canvas = page.getByTestId('infinite-canvas')
  await canvas.click({ button: 'right', position: { x: 300, y: 240 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()
  const window = page.getByTestId('canvas-window')
  const before = await window.boundingBox()
  if (!before) throw new Error('Canvas window not laid out')

  await canvas.hover({ position: { x: 300, y: 240 } })
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, 400)
  await page.keyboard.up('Control')
  await expect(page.getByTitle('Reset zoom')).not.toHaveText('100%')
  await expect(window.getByText('Double-click to focus')).toBeVisible()

  const after = await window.boundingBox()
  if (!after) throw new Error('Far-zoom canvas window not laid out')
  expect(after.width / after.height).toBeCloseTo(before.width / before.height, 2)
})

test('keeps browser panes mounted through every zoom level', async ({ page }) => {
  const canvas = page.getByTestId('infinite-canvas')
  await canvas.click({ button: 'right', position: { x: 40, y: 40 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()
  const window = page.getByTestId('canvas-window')
  await window.locator('[data-file-path="Documents"]').click()
  const note = window.locator('[data-file-path="Documents/notes.md"]')
  await expect(note).toBeVisible()
  const content = window.locator('[data-canvas-window-content]')
  await content.evaluate((element) => element.setAttribute('data-zoom-mount-sentinel', 'stable'))

  await canvas.hover({ position: { x: 900, y: 600 } })
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, 1600)
  await page.keyboard.up('Control')
  await expect(page.getByTestId('canvas-window-summary')).toBeVisible()

  await page.getByTitle('Reset zoom').click()
  await expect(page.getByTestId('canvas-window-summary')).toBeHidden()
  await expect(content).toHaveAttribute('data-zoom-mount-sentinel', 'stable')
  await expect(note).toBeVisible()
})

test('pans canvas without disturbing pane content', async ({ page }) => {
  const canvas = page.getByTestId('infinite-canvas')
  await canvas.click({ button: 'right', position: { x: 40, y: 40 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()
  const content = page.locator('[data-canvas-window-content]')
  await content.evaluate((element) => element.setAttribute('data-pan-mount-sentinel', 'stable'))
  const world = page.getByTestId('canvas-world')
  const before = await world.getAttribute('style')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Canvas not laid out')

  await page.mouse.move(box.x + 900, box.y + 600)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(box.x + 1080, box.y + 700, { steps: 30 })
  await page.mouse.up({ button: 'middle' })

  await expect(world).not.toHaveAttribute('style', before ?? '')
  await expect(content).toHaveAttribute('data-pan-mount-sentinel', 'stable')
  await expect(page.locator('[data-file-path]').first()).toBeVisible()
})

test('previews exact window bounds while dragging a file onto canvas', async ({ page }) => {
  const canvas = page.getByTestId('infinite-canvas')
  await canvas.evaluate((element) => {
    const transfer = new DataTransfer()
    transfer.setData(
      'application/x-derp-file-drag',
      JSON.stringify({ path: 'preview.md', isDirectory: false, sourceKind: 'local' }),
    )
    element.dispatchEvent(
      new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        clientX: 320,
        clientY: 256,
        dataTransfer: transfer,
      }),
    )
  })
  const preview = page.getByTestId('canvas-drop-preview')
  await expect(preview).toBeVisible()
  await expect(preview).toContainText('640 × 480')
  const previewBox = await preview.boundingBox()
  if (!previewBox) throw new Error('Canvas drop preview not laid out')
  expect(previewBox.x + previewBox.width / 2).toBeCloseTo(320, 0)
  expect(previewBox.y + previewBox.height / 2).toBeCloseTo(256, 0)

  await page.evaluate(() => document.dispatchEvent(new DragEvent('dragend', { bubbles: true })))
  await expect(preview).toBeHidden()

  await canvas.evaluate((element) => {
    const transfer = new DataTransfer()
    transfer.setData(
      'application/x-derp-file-drag',
      JSON.stringify({ path: 'preview.md', isDirectory: false, sourceKind: 'local' }),
    )
    element.dispatchEvent(
      new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        clientX: 320,
        clientY: 256,
        dataTransfer: transfer,
      }),
    )
  })
  await expect(preview).toBeVisible()

  await canvas.evaluate((element) => {
    const transfer = new DataTransfer()
    transfer.setData(
      'application/x-derp-file-drag',
      JSON.stringify({ path: 'preview.md', isDirectory: false, sourceKind: 'local' }),
    )
    element.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX: 320,
        clientY: 256,
        dataTransfer: transfer,
      }),
    )
  })

  await expect(preview).toBeHidden()
  const windowBox = await page.getByTestId('canvas-window').boundingBox()
  if (!windowBox) throw new Error('Dropped canvas window not laid out')
  expect(windowBox).toEqual(previewBox)
})

test('updates preview position during a real file-browser row drag', async ({ page }) => {
  const canvas = page.getByTestId('infinite-canvas')
  await canvas.click({ button: 'right', position: { x: 40, y: 40 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()
  const row = page.locator('[data-file-path][draggable="true"]').first()
  await expect(row).toBeVisible()
  const rowBox = await row.boundingBox()
  if (!rowBox) throw new Error('Draggable browser row not laid out')

  await page.mouse.move(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(rowBox.x + rowBox.width / 2 + 20, rowBox.y + rowBox.height / 2, {
    steps: 4,
  })
  const preview = page.getByTestId('canvas-drop-preview')
  await expect(preview).toBeHidden()
  await page.mouse.move(850, 180, { steps: 10 })
  await expect(preview).toBeVisible()
  const first = await preview.boundingBox()
  if (!first) throw new Error('First real-drag preview not laid out')

  await page.mouse.move(1050, 500, { steps: 10 })
  await expect
    .poll(async () => (await preview.boundingBox())?.x ?? Number.NEGATIVE_INFINITY)
    .toBeGreaterThan(first.x)
  await expect
    .poll(async () => (await preview.boundingBox())?.y ?? Number.NEGATIVE_INFINITY)
    .toBeGreaterThan(first.y)
  await page.mouse.up()
})

test('keeps file-browser directory and file clicks interactive', async ({ page }) => {
  const canvas = page.getByTestId('infinite-canvas')
  await canvas.click({ button: 'right', position: { x: 40, y: 40 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()
  const browserWindow = page.getByTestId('canvas-window')
  const resizeHandle = await browserWindow.locator('[data-canvas-resize="e"]').boundingBox()
  if (!resizeHandle) throw new Error('Canvas browser resize handle not laid out')
  await page.mouse.move(
    resizeHandle.x + resizeHandle.width / 2,
    resizeHandle.y + resizeHandle.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    resizeHandle.x + resizeHandle.width / 2 + 128,
    resizeHandle.y + resizeHandle.height / 2,
  )
  await page.mouse.up()
  const directory = page.locator('[data-file-path="Documents"]')
  const contentBox = await page.locator('[data-canvas-window-content]').boundingBox()
  const directoryBox = await directory.boundingBox()
  if (!contentBox || !directoryBox) throw new Error('Canvas browser row not laid out')
  expect(directoryBox.x + directoryBox.width).toBeCloseTo(contentBox.x + contentBox.width, 0)
  await directory.click()
  const note = page.locator('[data-file-path="Documents/notes.md"]')
  await expect(note).toBeVisible()
  const noteSizeBox = await note.locator('td').last().boundingBox()
  const resizedContentBox = await page.locator('[data-canvas-window-content]').boundingBox()
  if (!noteSizeBox || !resizedContentBox) throw new Error('Canvas browser size cell not laid out')
  expect(noteSizeBox.x + noteSizeBox.width).toBeCloseTo(
    resizedContentBox.x + resizedContentBox.width,
    0,
  )
  await note.click()
  await expect(page.getByTestId('canvas-window')).toHaveCount(2)
})

test('does not remount existing panes when another window opens', async ({ page }) => {
  const canvas = page.getByTestId('infinite-canvas')
  await canvas.click({ button: 'right', position: { x: 40, y: 40 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()
  const firstWindow = page.getByTestId('canvas-window').first()
  await firstWindow.locator('[data-file-path="Documents"]').click()
  const note = firstWindow.locator('[data-file-path="Documents/notes.md"]')
  await expect(note).toBeVisible()

  const content = firstWindow.locator('[data-canvas-window-content]')
  await content.evaluate((element) => element.setAttribute('data-remount-sentinel', 'stable'))
  await canvas.click({ button: 'right', position: { x: 1100, y: 650 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()

  await expect(page.getByTestId('canvas-window')).toHaveCount(2)
  await expect(content).toHaveAttribute('data-remount-sentinel', 'stable')
  await expect(note).toBeVisible()
})

test('creates dotted knowledge-base note names with md extension', async ({ page }) => {
  const canvas = page.getByTestId('infinite-canvas')
  await canvas.click({ button: 'right', position: { x: 40, y: 40 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()
  await page.locator('[data-file-path="Notes"]').click()
  await page.getByRole('button', { name: 'New file', exact: true }).click()
  const stem = `canvas.${Date.now()}.08.08`
  await page.getByPlaceholder('File name (e.g. notes.md)').fill(stem)
  const created = page.waitForResponse(
    (response) =>
      response.url().includes('/api/files/create') && response.request().method() === 'POST',
  )
  await page.getByPlaceholder('File name (e.g. notes.md)').press('Enter')
  expect((await created).ok()).toBe(true)

  const listing = await page.request.get('/api/files?dir=Notes')
  const body = (await listing.json()) as { files: Array<{ name: string }> }
  expect(body.files.some((file) => file.name === `${stem}.md`)).toBe(true)
  expect(body.files.some((file) => file.name === stem)).toBe(false)
})

test('loads large virtualized directories inside canvas browser', async ({ page }) => {
  const folderName = `CanvasLarge-${batchId ?? 'local'}`
  const folderPath = path.resolve(mediaDirName, folderName)
  fs.mkdirSync(folderPath, { recursive: true })
  for (let index = 0; index < 140; index += 1) {
    fs.writeFileSync(path.join(folderPath, `canvas-item-${String(index).padStart(3, '0')}.txt`), '')
  }
  await page.reload()

  const canvas = page.getByTestId('infinite-canvas')
  await canvas.click({ button: 'right', position: { x: 40, y: 40 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()
  await page.locator(`[data-file-path="${folderName}"]`).click()
  const firstItem = page.locator(`[data-file-path="${folderName}/canvas-item-000.txt"]`)
  await expect(firstItem).toBeVisible()
  await page.locator('[data-breadcrumb-path=""]').click()
  await page.locator(`[data-file-path="${folderName}"]`).click()
  await expect(firstItem).toBeVisible()

  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = localStorage.getItem('infinite-canvas-state-v1')
        if (!raw) return null
        const state = JSON.parse(raw) as {
          windows?: Array<{ definition?: { initialState?: { dir?: string } } }>
        }
        return state.windows?.[0]?.definition?.initialState?.dir ?? null
      }),
    )
    .toBe(folderName)
  await page.reload()
  await expect(firstItem).toBeVisible()
})

test('restores virtualized browser rows after complete window remount', async ({ page }) => {
  const folderName = `CanvasRemount-${batchId ?? 'local'}`
  const folderPath = path.resolve(mediaDirName, folderName)
  fs.mkdirSync(folderPath, { recursive: true })
  for (let index = 0; index < 140; index += 1) {
    fs.writeFileSync(
      path.join(folderPath, `remount-item-${String(index).padStart(3, '0')}.txt`),
      '',
    )
  }
  await page.reload()

  const canvas = page.getByTestId('infinite-canvas')
  await canvas.click({ button: 'right', position: { x: 40, y: 40 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()
  await page.locator(`[data-file-path="${folderName}"]`).click()
  const firstItem = page.locator(`[data-file-path="${folderName}/remount-item-000.txt"]`)
  await expect(firstItem).toBeVisible()

  await page.goto('/')
  await page.goto('/canvas')
  await expect(firstItem).toBeVisible()
  await expect(page.locator(`[data-file-path^="${folderName}/remount-item-"]`)).not.toHaveCount(0)

  await page.getByTestId('infinite-canvas').hover({ position: { x: 900, y: 600 } })
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, 1600)
  await page.keyboard.up('Control')
  await page.getByTitle('Reset zoom').click()
  await expect(firstItem).toBeVisible()
})

test('keeps delayed directory loads alive after canvas browser clicks', async ({ page }) => {
  test.slow()
  const folderName = `CanvasSlow-${batchId ?? 'local'}`
  const folderPath = path.resolve(mediaDirName, folderName)
  fs.mkdirSync(folderPath, { recursive: true })
  fs.writeFileSync(path.join(folderPath, 'loaded.txt'), 'loaded')
  await page.route(`**/api/files?dir=${folderName}`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500))
    await route.continue()
  })
  await page.reload()

  const canvas = page.getByTestId('infinite-canvas')
  await canvas.click({ button: 'right', position: { x: 40, y: 40 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()
  await page.locator(`[data-file-path="${folderName}"]`).click()
  await expect(page.locator(`[data-file-path="${folderName}/loaded.txt"]`)).toBeVisible()
})

test('remembers resized dimensions for new windows of same type', async ({ page }) => {
  const canvas = page.getByTestId('infinite-canvas')
  await canvas.click({ button: 'right', position: { x: 80, y: 80 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()
  const first = page.getByTestId('canvas-window').first()
  const before = await first.boundingBox()
  if (!before) throw new Error('Canvas browser window not laid out')

  const resize = first.locator('[data-canvas-resize="se"]')
  const handle = await resize.boundingBox()
  if (!handle) throw new Error('Canvas resize handle not laid out')
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2 + 96, handle.y + handle.height / 2 + 64)
  await page.mouse.up()

  const resized = await first.boundingBox()
  if (!resized) throw new Error('Resized canvas browser window not laid out')
  expect(resized.width).toBeGreaterThan(before.width)
  expect(resized.height).toBeGreaterThan(before.height)

  await canvas.evaluate((element) => {
    const transfer = new DataTransfer()
    transfer.setData(
      'application/x-derp-file-drag',
      JSON.stringify({ path: 'folder', isDirectory: true, sourceKind: 'local' }),
    )
    transfer.setData('application/x-derp-file-drag-directory', '1')
    element.dispatchEvent(
      new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        clientX: 900,
        clientY: 120,
        dataTransfer: transfer,
      }),
    )
  })
  const preview = page.getByTestId('canvas-drop-preview')
  const previewBox = await preview.boundingBox()
  if (!previewBox) throw new Error('Remembered-size drop preview not laid out')
  expect(previewBox.width).toBe(resized.width)
  expect(previewBox.height).toBe(resized.height)
  await page.evaluate(() => document.dispatchEvent(new DragEvent('dragend', { bubbles: true })))
  await expect(preview).toBeHidden()

  await canvas.click({ button: 'right', position: { x: 900, y: 120 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()
  const created = await page.getByTestId('canvas-window').nth(1).boundingBox()
  if (!created) throw new Error('Second canvas browser window not laid out')
  expect(created.width).toBe(resized.width)
  expect(created.height).toBe(resized.height)
})

test('dismisses canvas context menu when interacting with a window', async ({ page }) => {
  const canvas = page.getByTestId('infinite-canvas')
  await canvas.click({ button: 'right', position: { x: 120, y: 120 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()
  const window = page.getByTestId('canvas-window')
  await expect(window).toBeVisible()

  await canvas.click({ button: 'right', position: { x: 1150, y: 650 } })
  await expect(page.getByRole('button', { name: 'New frame' })).toBeVisible()
  await window.click({ position: { x: 120, y: 100 } })
  await expect(page.getByRole('button', { name: 'New frame' })).toBeHidden()

  await canvas.click({ button: 'right', position: { x: 1150, y: 650 } })
  await expect(page.getByRole('button', { name: 'New frame' })).toBeVisible()
  const box = await window.boundingBox()
  if (!box) throw new Error('Canvas window not laid out')
  await page.mouse.move(box.x + 120, box.y + 16)
  await page.mouse.down()
  await expect(page.getByRole('button', { name: 'New frame' })).toBeHidden()
  await page.mouse.up()
})
