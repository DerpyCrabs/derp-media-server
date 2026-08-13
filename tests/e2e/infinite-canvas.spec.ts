import { expect, test } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const batchId = process.env.BATCH_ID
const mediaDirName = batchId ? `test-media-${batchId}` : 'test-media'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/canvases**', async (route) => {
    const body =
      route.request().method() === 'POST'
        ? (route.request().postDataJSON() as { canvases?: unknown[] })
        : null
    await route.fulfill({ json: { canvases: body?.canvases ?? [] } })
  })
  await page.addInitScript(() => {
    if (sessionStorage.getItem('canvas-test-initialized')) return
    sessionStorage.setItem('canvas-test-initialized', '1')
    localStorage.removeItem('infinite-canvas-state-v1')
    localStorage.removeItem('infinite-canvases-v1')
    localStorage.setItem('workspace-state-test-sentinel', 'untouched')
  })
  await page.goto('/canvas')
  await expect(page.getByTestId('infinite-canvas')).toBeVisible()
})

test('creates, names, switches, and restores canvases', async ({ page }) => {
  await page.getByTestId('canvas-name-trigger').click()
  await page.getByRole('button', { name: 'New canvas' }).click()
  await page.getByLabel('Name').fill('Projects')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('canvas-name-trigger')).toHaveText('Projects')

  await page.getByTestId('canvas-add-trigger').click()
  await page.getByRole('button', { name: 'File browser' }).click()

  await page.getByTestId('canvas-name-trigger').click()
  await page.getByRole('button', { name: 'New canvas' }).click()
  await page.getByLabel('Name').fill('Empty')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('canvas-window')).toHaveCount(0)

  await page.getByTestId('canvas-name-trigger').click()
  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  await expect(page.getByTestId('canvas-window')).toHaveCount(1)

  await page.getByTestId('canvas-name-trigger').click()
  const renameProjects = page.getByLabel('Rename Projects')
  const projectsRow = page.getByTestId('canvas-list-item').filter({ hasText: 'Projects' })
  await expect(projectsRow.locator('[data-canvas-row-actions]')).toHaveCSS('opacity', '0')
  await projectsRow.hover()
  await expect(projectsRow.locator('[data-canvas-row-actions]')).toHaveCSS('opacity', '1')
  await renameProjects.click()
  await page.getByLabel('Name').fill('Projects renamed')
  await page.getByRole('button', { name: 'Save' }).click()

  await page.getByTestId('canvas-name-trigger').click()
  await page.getByTestId('canvas-list-item').filter({ hasText: 'Empty' }).hover()
  await page.getByLabel('Delete Empty').click()
  await page.getByRole('button', { name: 'Delete canvas' }).click()
  await page.getByTestId('canvas-name-trigger').click()
  await expect(page.getByRole('button', { name: 'Empty', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(page.getByTestId('canvas-name-trigger')).toHaveText('Projects renamed')
  await expect(page.getByTestId('canvas-window')).toHaveCount(1)
})

test('creates a real Markdown editor at the default canvas position', async ({ page }) => {
  const title = `Design brief ${Date.now()}`
  await page.getByTestId('canvas-add-trigger').click()
  await page.getByRole('banner').getByRole('button', { name: 'New document', exact: true }).click()
  await expect(page.getByText('Creates a Markdown file and opens it on this canvas.')).toBeVisible()
  await page.getByLabel('Document title').fill(title)
  await page.getByRole('button', { name: 'Create document' }).click()
  await expect(page.getByTestId('canvas-window')).toHaveCount(1)
  await expect(
    page.getByRole('textbox', { name: new RegExp(`${title}.* Markdown editor`) }),
  ).toBeVisible()
})

test('creates blank canvases', async ({ page }) => {
  await page.getByTestId('canvas-name-trigger').click()
  await page.getByRole('button', { name: 'New canvas' }).click()
  await page.getByLabel('Name').fill('Hardware plan')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('canvas-window')).toHaveCount(0)
})

test('searches canvases from picker', async ({ page }) => {
  await page.getByTestId('canvas-name-trigger').click()
  await page.getByRole('button', { name: 'New canvas' }).click()
  await page.getByLabel('Name').fill('Research board')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByTestId('canvas-name-trigger').click()
  await page.getByLabel('Search canvases').fill('Research')
  const row = page.getByTestId('canvas-list-item').filter({ hasText: 'Research board' })
  await expect(row).toBeVisible()
})

test('keeps canvas camera fixed with an unmodified wheel', async ({ page }) => {
  const canvas = page.getByTestId('infinite-canvas')
  await canvas.hover({ position: { x: 900, y: 500 } })
  const before = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('infinite-canvas-state-v1') ?? '{}') as {
      camera?: { x?: number; y?: number }
    }
    return raw.camera ?? { x: 0, y: 0 }
  })
  await page.mouse.wheel(40, 80)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = JSON.parse(localStorage.getItem('infinite-canvas-state-v1') ?? '{}') as {
          camera?: { x?: number; y?: number }
        }
        return raw.camera
      }),
    )
    .toEqual({ x: before.x ?? 0, y: before.y ?? 0, zoom: 1 })
})

test('closes canvas dialogs with Escape and restores focus', async ({ page }) => {
  const trigger = page.getByTestId('canvas-name-trigger')
  await trigger.click()
  await page.getByRole('button', { name: 'New canvas' }).click()
  await expect(page.getByRole('dialog', { name: 'New canvas' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'New canvas' })).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('closes overflow actions when clicking outside', async ({ page }) => {
  await page.getByTitle('More').click()
  await expect(page.getByRole('button', { name: 'Export canvas' })).toBeVisible()
  await page.getByTestId('infinite-canvas').click({ position: { x: 700, y: 500 } })
  await expect(page.getByRole('button', { name: 'Export canvas' })).toHaveCount(0)
})

test('keeps primary and zoom controls reachable on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 700 })
  await expect(page.getByText('Saved', { exact: true })).toHaveCount(0)
  const outline = page.getByTitle('Canvas outline')
  const title = page.getByTestId('canvas-name-trigger')
  expect((await outline.boundingBox())!.x).toBeLessThan((await title.boundingBox())!.x)
  await expect(page.getByTestId('canvas-add-trigger')).toHaveText('')
  await expect(page.getByTestId('canvas-search-trigger')).toHaveText('')
  await expect(page.getByTestId('canvas-create-tools')).toHaveCSS('column-gap', '8px')
  await expect(page.getByTestId('canvas-toolbar-divider')).toHaveCount(2)
  for (const locator of [
    outline,
    page.getByTestId('canvas-name-trigger'),
    page.getByTestId('canvas-add-trigger'),
    page.getByTestId('canvas-search-trigger'),
    page.getByTitle('More'),
    page.getByRole('slider', { name: 'Canvas zoom' }),
  ]) {
    await expect(locator).toBeVisible()
    const box = await locator.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x + box!.width).toBeLessThanOrEqual(600)
  }
})

test('shows only actionable canvas sync errors', async ({ page }) => {
  let failSync = true
  await page.unroute('**/api/canvases**')
  await page.route('**/api/canvases**', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fulfill({ json: { canvases: [] } })
      return
    }
    if (failSync) {
      await route.fulfill({ status: 500, json: { error: 'sync failed' } })
      return
    }
    const body = route.request().postDataJSON() as { canvases?: unknown[] }
    await route.fulfill({ json: { canvases: body.canvases ?? [] } })
  })

  await page.reload()
  const retry = page.getByTestId('canvas-sync-error')
  await expect(retry).toContainText('Sync failed')
  await expect(retry).toContainText('Retry')

  failSync = false
  await retry.click()
  await expect(retry).toHaveCount(0)
})

test('does not replace a live Hermes pane with stale sync content', async ({ page }) => {
  let syncResponses = 0
  await page.unroute('**/api/canvases**')
  await page.route('**/api/canvases**', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fulfill({ json: { canvases: [] } })
      return
    }
    const body = route.request().postDataJSON() as { canvases: any[] }
    syncResponses += 1
    const stale = body.canvases.map((canvas) => ({
      ...canvas,
      updatedAt: canvas.updatedAt + 1,
      state: {
        ...canvas.state,
        windows: canvas.state.windows.map((window: any) => ({
          ...window,
          definition:
            window.definition.type === 'hermes'
              ? { ...window.definition, title: 'Stale remote chat' }
              : window.definition,
        })),
      },
    }))
    await route.fulfill({ json: { canvases: stale } })
  })

  await page.getByTestId('canvas-add-trigger').click()
  await page.getByRole('button', { name: 'AI chat' }).click()
  const chat = page.getByTestId('hermes-chat-pane')
  await chat.getByPlaceholder('Message Hermes…').fill('Keep this unsent draft')
  await page.getByTestId('canvas-add-trigger').click()
  await page.getByRole('button', { name: 'File browser' }).click()
  await expect(chat.getByPlaceholder('Message Hermes…')).toHaveValue('Keep this unsent draft')
  await expect(page.getByTestId('canvas-window')).toHaveCount(2)
  await expect.poll(() => syncResponses).toBeGreaterThan(0)
  await expect(page.getByText('Stale remote chat', { exact: true })).toHaveCount(0)
})

test('persists canvas records through server sync API', async ({ request }) => {
  const id = `canvas-e2e-${Date.now()}`
  const record = {
    id,
    name: 'Server canvas',
    updatedAt: Date.now(),
    writerId: 'playwright',
    deleted: false,
    state: {
      version: 1,
      windows: [],
      camera: { x: 0, y: 0, zoom: 1 },
      windowSizeByType: {},
      nextItemId: 1,
      nextZIndex: 1,
    },
  }
  const saved = await request.post('/api/canvases/sync', { data: { canvases: [record] } })
  expect(saved.ok()).toBe(true)

  const loaded = await request.get('/api/canvases')
  expect(loaded.ok()).toBe(true)
  const body = (await loaded.json()) as { canvases: Array<{ id: string; name: string }> }
  expect(body.canvases).toContainEqual(expect.objectContaining({ id, name: 'Server canvas' }))

  const deleted = await request.post('/api/canvases/sync', {
    data: {
      canvases: [{ ...record, state: null, deleted: true, updatedAt: record.updatedAt + 1 }],
    },
  })
  expect(deleted.ok()).toBe(true)
})

test('locally restores canvas windows', async ({ page }) => {
  await page.getByTestId('infinite-canvas').click({ button: 'right', position: { x: 32, y: 650 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()
  await expect(page.getByTestId('canvas-window')).toHaveCount(1)

  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = localStorage.getItem('infinite-canvas-state-v1')
        if (!raw) return null
        const state = JSON.parse(raw) as { windows?: unknown[] }
        return state.windows?.length ?? 0
      }),
    )
    .toBe(1)
  await page.reload()
  await expect(page.getByTestId('canvas-window')).toHaveCount(1)
  expect(await page.evaluate(() => localStorage.getItem('workspace-state-test-sentinel'))).toBe(
    'untouched',
  )
})

test('opens unified search with Ctrl+P and overrides print', async ({ page }) => {
  await page.keyboard.press('Control+P')
  const palette = page.getByTestId('canvas-search-palette')
  await expect(palette).toBeVisible()
  await expect(page.getByPlaceholder('Search windows, files and folders…')).toBeFocused()
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

test('zooms around cursor and controls zoom from toolbar slider', async ({ page }) => {
  const canvas = page.getByTestId('infinite-canvas')
  const slider = page.getByRole('slider', { name: 'Canvas zoom' })
  const before = await page.getByTitle('Reset zoom').textContent()
  await expect(slider).toHaveValue('100')
  await canvas.hover({ position: { x: 400, y: 300 } })
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, 300)
  await page.keyboard.up('Control')
  await expect.poll(() => page.getByTitle('Reset zoom').textContent()).not.toBe(before)
  await slider.fill('60')
  await expect(page.getByTitle('Reset zoom')).toHaveText('60%')
  await page.getByTestId('canvas-zoom-control').hover({ position: { x: 4, y: 2 } })
  await page.mouse.wheel(0, 100)
  await expect(page.getByTitle('Reset zoom')).toHaveText('55%')
  await page.getByTitle('Reset zoom').click()
  await expect(page.getByTitle('Reset zoom')).toHaveText('100%')
  await expect(slider).toHaveValue('100')
})

test('hides canvas zoom controls behind a maximized window', async ({ page }) => {
  const canvas = page.getByTestId('infinite-canvas')
  await canvas.click({ button: 'right', position: { x: 300, y: 240 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()
  const window = page.getByTestId('canvas-window')
  await window.getByRole('button', { name: /Maximize/ }).click()
  await expect(page.getByTestId('canvas-zoom-control')).toHaveCount(0)
  await window.getByRole('button', { name: /Minimize/ }).click()
  await expect(page.getByTestId('canvas-zoom-control')).toBeVisible()
})

test('preserves window shape across semantic zoom levels', async ({ page }) => {
  const canvas = page.getByTestId('infinite-canvas')
  await canvas.click({ button: 'right', position: { x: 300, y: 240 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()
  const window = page.getByTestId('canvas-window')
  const titlebar = window.getByTestId('canvas-window-titlebar')
  await expect(window.getByTestId('canvas-window-title')).toBeVisible()
  await expect(window).toHaveCSS('border-top-width', '1px')
  await expect(titlebar).toHaveCSS('border-bottom-width', '1px')
  await expect(titlebar).toHaveCSS('height', '32px')
  await expect(titlebar).toHaveCSS('padding-left', '8px')
  await expect(titlebar).toHaveCSS('column-gap', '8px')
  await expect(titlebar).toHaveCSS('font-size', '12px')
  await expect(window.locator('[data-canvas-window-content]')).toHaveCSS('top', '32px')
  const liveTitleIconBounds = await titlebar.locator('svg').first().boundingBox()
  expect(liveTitleIconBounds?.width).toBe(14)
  expect(liveTitleIconBounds?.height).toBe(14)
  const maximizeButton = window.getByRole('button', { name: /Maximize/ })
  const maximizeBounds = await maximizeButton.boundingBox()
  const maximizeIconBounds = await maximizeButton.locator('svg').boundingBox()
  expect(maximizeBounds?.width).toBe(32)
  expect(maximizeBounds?.height).toBe(31)
  expect(maximizeIconBounds?.width).toBe(14)
  expect(maximizeIconBounds?.height).toBe(14)
  const before = await window.boundingBox()
  if (!before) throw new Error('Canvas window not laid out')

  await page.getByRole('slider', { name: 'Canvas zoom' }).fill('45')
  await expect(window.getByText('File browser', { exact: true })).toBeVisible()
  await expect(window).toHaveCSS('border-top-width', '0px')
  await expect(titlebar).toHaveCSS('border-bottom-width', '0px')
  const zoomedTitlebarBounds = await titlebar.boundingBox()
  const zoomedMaximizeBounds = await maximizeButton.boundingBox()
  const zoomedSummaryTitleBounds = await window
    .getByTestId('canvas-window-zoom-title')
    .boundingBox()
  const zoomedSummaryKindBounds = await window.getByTestId('canvas-window-zoom-kind').boundingBox()
  expect(zoomedTitlebarBounds?.height).toBeGreaterThanOrEqual(31)
  expect(zoomedMaximizeBounds?.width).toBeGreaterThanOrEqual(31)
  await expect(window.getByTestId('canvas-window-title')).toHaveCount(0)
  await expect(window).not.toHaveCSS('box-shadow', 'none')
  expect(zoomedSummaryTitleBounds?.height).toBeGreaterThanOrEqual(20)
  expect(zoomedSummaryKindBounds?.height).toBeGreaterThanOrEqual(14)

  const after = await window.boundingBox()
  if (!after) throw new Error('Far-zoom canvas window not laid out')
  expect(after.width / after.height).toBeCloseTo(before.width / before.height, 2)

  await page.getByRole('slider', { name: 'Canvas zoom' }).fill('20')
  const summary = page.getByTestId('canvas-window-summary')
  await expect(summary).toBeVisible()
  await expect(summary).toHaveCSS('border-top-width', '0px')
  await expect(summary.getByText('File browser', { exact: true })).toBeVisible()
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

test('uses image arrow navigation without nudging the selected canvas window', async ({ page }) => {
  const canvas = page.getByTestId('infinite-canvas')
  await canvas.click({ button: 'right', position: { x: 40, y: 40 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()
  const browserWindow = page.getByTestId('canvas-window').first()
  await browserWindow.locator('[data-file-path="Images"]').click()
  await browserWindow.locator('[data-file-path="Images/photo.jpg"]').click()

  const initialImageWindow = page.getByTestId('canvas-window').filter({
    has: page.locator('img[alt="photo.jpg"]'),
  })
  await expect(initialImageWindow).toBeVisible()
  const windowId = await initialImageWindow.getAttribute('data-window-id')
  if (!windowId) throw new Error('Image window has no stable id')
  const imageWindow = page.locator(`[data-testid="canvas-window"][data-window-id="${windowId}"]`)
  await expect(imageWindow).toBeVisible()
  await imageWindow.click()
  const before = await imageWindow.boundingBox()
  if (!before) throw new Error('Image window not laid out')

  await page.keyboard.press('ArrowRight')
  await expect(imageWindow.locator('img[alt="photo.png"]')).toBeVisible()
  const after = await imageWindow.boundingBox()
  expect(after?.x).toBeCloseTo(before.x, 1)
  expect(after?.y).toBeCloseTo(before.y, 1)
})

test('keeps canvas camera fixed when a book changes chapter or reopens', async ({ page }) => {
  const canvas = page.getByTestId('infinite-canvas')
  await canvas.click({ button: 'right', position: { x: 40, y: 40 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()
  const browserWindow = page.getByTestId('canvas-window').first()
  await browserWindow.locator('[data-file-path="Documents"]').click()
  const bookRow = browserWindow.locator('[data-file-path="Documents/reader.epub"]')
  await bookRow.click()
  await expect(page.getByTestId('reader-book')).toBeVisible()
  await page.getByTestId('reader-outline').getByText('Opening', { exact: true }).click()
  await expect(page.getByTestId('reader-book-progress')).toContainText('Opening')

  const selectableText = page
    .getByTestId('reader-book')
    .getByText('Selectable EPUB text begins here.')
  const textBox = await selectableText.boundingBox()
  if (!textBox) throw new Error('EPUB text not laid out')
  const selectionY = textBox.y + textBox.height / 2
  await page.mouse.move(textBox.x + 2, selectionY)
  await page.mouse.down()
  await page.mouse.move(Math.min(textBox.x + textBox.width - 2, textBox.x + 180), selectionY, {
    steps: 8,
  })
  await page.mouse.up()
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString().trim() ?? ''))
    .not.toBe('')
  await expect(page.getByTestId('reader-selection-menu')).toBeVisible()

  const cameraBefore = await page.getByTestId('canvas-world').getAttribute('style')
  const offsets = () =>
    canvas.evaluate((element) => ({
      left: element.scrollLeft,
      top: element.scrollTop,
      pageX: window.scrollX,
      pageY: window.scrollY,
    }))
  const offsetsBefore = await offsets()
  await page.getByRole('button', { name: 'Next chapter' }).click()
  await expect(page.getByTestId('reader-book-progress')).toContainText('Second chapter')
  expect(await offsets()).toEqual(offsetsBefore)
  expect(await page.getByTestId('canvas-world').getAttribute('style')).toBe(cameraBefore)

  await page.getByRole('button', { name: 'Close reader.epub' }).click()
  await bookRow.click()
  await expect(page.getByTestId('reader-book')).toBeVisible()
  expect(await offsets()).toEqual(offsetsBefore)
  expect(await page.getByTestId('canvas-world').getAttribute('style')).toBe(cameraBefore)
})

test('fits short semantic cards across every zoom level', async ({ page }) => {
  const canvas = page.getByTestId('infinite-canvas')
  await canvas.click({ button: 'right', position: { x: 40, y: 40 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()
  const browserWindow = page.getByTestId('canvas-window').first()
  await browserWindow.locator('[data-file-path="Music"]').click()
  await browserWindow.locator('[data-file-path="Music/track.mp3"]').click()
  const audioWindow = page.getByTestId('canvas-window').filter({ has: page.locator('audio') })
  const slider = page.getByRole('slider', { name: 'Canvas zoom' })

  const expectContained = async (
    child: ReturnType<typeof page.getByTestId>,
    parent: typeof audioWindow,
  ) => {
    const parentHandle = await parent.elementHandle()
    if (!parentHandle) throw new Error('Semantic card parent not laid out')
    const { childBox, parentBox } = await child.evaluate((childElement, parentElement) => {
      const childRect = childElement.getBoundingClientRect()
      const parentRect = parentElement.getBoundingClientRect()
      return {
        childBox: {
          x: childRect.x,
          y: childRect.y,
          width: childRect.width,
          height: childRect.height,
        },
        parentBox: {
          x: parentRect.x,
          y: parentRect.y,
          width: parentRect.width,
          height: parentRect.height,
        },
      }
    }, parentHandle)
    expect(childBox.x).toBeGreaterThanOrEqual(parentBox.x - 1)
    expect(childBox.y).toBeGreaterThanOrEqual(parentBox.y - 1)
    expect(childBox.x + childBox.width).toBeLessThanOrEqual(parentBox.x + parentBox.width + 1)
    expect(childBox.y + childBox.height).toBeLessThanOrEqual(parentBox.y + parentBox.height + 1)
  }

  for (const zoom of ['60', '45', '35', '29']) {
    await slider.fill(zoom)
    await expect(audioWindow.getByTestId('canvas-window-title')).toHaveCount(0)
    for (const testId of [
      'canvas-window-zoom-icon',
      'canvas-window-zoom-title',
      'canvas-window-zoom-kind',
    ]) {
      const element = audioWindow.getByTestId(testId)
      await expect(element).toBeVisible()
      await expectContained(element, audioWindow)
    }
  }

  await slider.fill('20')
  const farSummaries = page.getByTestId('canvas-window-summary')
  await expect(farSummaries).toHaveCount(2)
  for (const summary of await farSummaries.all()) {
    const content = summary.getByTestId('canvas-window-summary-content')
    const summaryHandle = await summary.elementHandle()
    if (!summaryHandle) throw new Error('Far summary not laid out')
    const { summaryBox, contentBox } = await content.evaluate((contentElement, summaryElement) => {
      const summaryRect = summaryElement.getBoundingClientRect()
      const contentRect = contentElement.getBoundingClientRect()
      return {
        summaryBox: { width: summaryRect.width, height: summaryRect.height },
        contentBox: { width: contentRect.width, height: contentRect.height },
      }
    }, summaryHandle)
    expect(contentBox.width).toBeGreaterThanOrEqual(summaryBox.width - 1)
    expect(contentBox.height).toBeGreaterThanOrEqual(summaryBox.height - 1)
    await expectContained(summary.getByTestId('canvas-window-summary-title'), summary)
  }
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
  await expect(preview).toContainText('768 × 544')
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

test('restores an image-folder reader after reload', async ({ page }) => {
  const canvas = page.getByTestId('infinite-canvas')
  await canvas.click({ button: 'right', position: { x: 40, y: 40 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()
  const browserWindow = page.getByTestId('canvas-window').first()
  await browserWindow.locator('[data-file-path="Images"]').click({ button: 'right' })
  await page.getByTestId('open-with-menu').click()
  await page.getByTestId('open-with-reader').click()

  const readerWindow = page.getByTestId('canvas-window').filter({
    has: page.getByTestId('reader-dialog'),
  })
  await expect(readerWindow).toBeVisible()
  await expect(readerWindow.locator('svg.lucide-book-open').first()).toBeVisible()
  await expect(readerWindow.locator('svg.lucide-folder')).toHaveCount(0)
  await expect(readerWindow.getByTestId('reader-image-page')).toHaveCount(2)
  await expect(readerWindow.getByTestId('region-layer').first()).toHaveCSS('pointer-events', 'auto')

  await page.reload()

  const restoredReader = page.getByTestId('canvas-window').filter({
    has: page.getByTestId('reader-dialog'),
  })
  await expect(restoredReader).toBeVisible()
  await expect(restoredReader.locator('svg.lucide-book-open').first()).toBeVisible()
  await expect(restoredReader.locator('svg.lucide-folder')).toHaveCount(0)
  await expect(restoredReader.getByTestId('reader-image-page')).toHaveCount(2)
  await expect(restoredReader.getByText('This file type cannot be previewed.')).toHaveCount(0)
})

test('shows only canvas-supported file actions', async ({ page }) => {
  const canvas = page.getByTestId('infinite-canvas')
  await canvas.click({ button: 'right', position: { x: 40, y: 40 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()

  await page.locator('[data-file-path="Documents"]').click({ button: 'right' })
  const menu = page.locator('[data-slot="file-row-context-menu"]')
  await expect(menu.getByRole('menuitem', { name: 'Open in new canvas window' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Open in split view' })).toHaveCount(0)
  await expect(menu.getByRole('menuitem', { name: 'Open in new tab' })).toHaveCount(0)
  await expect(menu.getByRole('menuitem', { name: 'Add to taskbar' })).toHaveCount(0)
})

test('shows a metadata-rich canvas audio player', async ({ page }) => {
  const canvas = page.getByTestId('infinite-canvas')
  await canvas.click({ button: 'right', position: { x: 40, y: 40 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()
  const browserWindow = page.getByTestId('canvas-window').first()
  await browserWindow.locator('[data-file-path="Music"]').click()
  await browserWindow.locator('[data-file-path="Music/track.mp3"]').click()

  const audioWindow = page.getByTestId('canvas-window').filter({ has: page.locator('audio') })
  await expect(audioWindow).toBeVisible()
  const audio = audioWindow.locator('audio')
  await expect(audioWindow.getByTestId('canvas-audio-player-ui')).toBeVisible()
  await expect(audioWindow.getByRole('heading', { name: 'track.mp3' })).toBeVisible()
  await expect(audioWindow.getByText('Unknown artist')).toBeVisible()
  await expect(audioWindow.getByLabel('Playback position')).toBeVisible()
  await expect(audioWindow.getByLabel('Volume')).toBeVisible()
  await expect(audioWindow.getByLabel('Download')).toBeVisible()
  await expect
    .poll(async () => audio.evaluate((element: HTMLAudioElement) => element.readyState))
    .toBeGreaterThanOrEqual(2)
  const browserBox = await browserWindow.boundingBox()
  const audioBox = await audioWindow.boundingBox()
  if (!browserBox || !audioBox) throw new Error('Canvas media windows not laid out')
  expect(audioBox.height).toBeLessThan(browserBox.height)
})

test('switches canvas audio layouts as its window is resized', async ({ page }) => {
  await page.route('**/api/audio/metadata/Music/track.flac', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ title: 'Fixture Track', artist: 'Fixture Artist' }),
    })
  })
  const canvas = page.getByTestId('infinite-canvas')
  await canvas.click({ button: 'right', position: { x: 40, y: 40 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()
  const browserWindow = page.getByTestId('canvas-window').first()
  await browserWindow.locator('[data-file-path="Music"]').click()
  await browserWindow.locator('[data-file-path="Music/track.mp3"]').click()

  const audioWindow = page.getByTestId('canvas-window').filter({ has: page.locator('audio') })
  const player = audioWindow.getByTestId('canvas-audio-player-ui')
  await expect(player).toHaveAttribute('data-audio-layout', 'standard')
  await audioWindow.evaluate((element: HTMLElement) => {
    element.style.width = '800px'
    element.style.height = '420px'
  })
  await expect(player).toHaveAttribute('data-audio-layout', 'expanded')
  await expect(audioWindow.getByTestId('canvas-audio-playlist')).toBeVisible()
  await expect(audioWindow.getByText('Folder playlist')).toHaveCount(0)
  await expect(audioWindow.getByText('Fixture Artist — Fixture Track')).toBeVisible()
  await expect(audioWindow.locator('[data-audio-playlist-path="Music/track.flac"]')).toBeVisible()

  await audioWindow.evaluate((element: HTMLElement) => {
    element.style.height = '288px'
  })
  await expect(player).toHaveAttribute('data-audio-layout', 'expanded')
  await expect(audioWindow.getByTestId('canvas-audio-playlist')).toBeVisible()

  await audioWindow.evaluate((element: HTMLElement) => {
    element.style.width = '420px'
    element.style.height = '220px'
  })
  await expect(player).toHaveAttribute('data-audio-layout', 'compact')
  await expect(audioWindow.getByTestId('canvas-audio-playlist')).toHaveCount(0)
})

test('keeps multiple audio players but allows only one to play and focuses it from header', async ({
  page,
}) => {
  const canvas = page.getByTestId('infinite-canvas')
  await canvas.click({ button: 'right', position: { x: 40, y: 40 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()
  const browserWindow = page.getByTestId('canvas-window').first()
  await browserWindow.locator('[data-file-path="Music"]').click()
  await browserWindow.locator('[data-file-path="Music/track.mp3"]').click()

  const firstWindow = page
    .getByTestId('canvas-window')
    .filter({ has: page.locator('audio[title="track.mp3"]') })
  const firstAudio = firstWindow.locator('audio')
  await firstAudio.evaluate((element: HTMLAudioElement) => {
    element.loop = true
  })
  await expect
    .poll(async () => firstAudio.evaluate((element: HTMLAudioElement) => element.paused))
    .toBe(true)
  await expect(page.getByTestId('canvas-playing-audio-focus')).toHaveAttribute(
    'aria-label',
    /track\.mp3/,
  )
  await firstWindow.getByRole('button', { name: 'Play' }).click()
  await expect
    .poll(async () => firstAudio.evaluate((element: HTMLAudioElement) => !element.paused))
    .toBe(true)

  await browserWindow.locator('[data-file-path="Music/track.flac"]').click()
  const secondWindow = page
    .getByTestId('canvas-window')
    .filter({ has: page.locator('audio[title="track.flac"]') })
  const secondAudio = secondWindow.locator('audio')
  await secondAudio.evaluate((element: HTMLAudioElement) => {
    element.loop = true
  })
  await expect(page.getByTestId('canvas-window')).toHaveCount(3)
  await expect
    .poll(async () => secondAudio.evaluate((element: HTMLAudioElement) => element.paused))
    .toBe(true)
  await expect
    .poll(async () => firstAudio.evaluate((element: HTMLAudioElement) => !element.paused))
    .toBe(true)

  await secondWindow.getByRole('button', { name: 'Play' }).click()
  await expect
    .poll(async () => secondAudio.evaluate((element: HTMLAudioElement) => !element.paused))
    .toBe(true)
  await expect
    .poll(async () => firstAudio.evaluate((element: HTMLAudioElement) => element.paused))
    .toBe(true)

  await firstWindow.getByRole('button', { name: 'Play' }).click()
  await expect
    .poll(async () => firstAudio.evaluate((element: HTMLAudioElement) => !element.paused))
    .toBe(true)
  await expect
    .poll(async () => secondAudio.evaluate((element: HTMLAudioElement) => element.paused))
    .toBe(true)

  await firstWindow.getByRole('button', { name: 'Pause' }).click()
  await expect
    .poll(async () => firstAudio.evaluate((element: HTMLAudioElement) => element.paused))
    .toBe(true)

  await secondWindow.click({ position: { x: 120, y: 16 } })
  await expect(page.getByTestId('canvas-window-breadcrumb')).toHaveText('track.flac')
  const focusPlaying = page.getByTestId('canvas-playing-audio-focus')
  await expect(focusPlaying).toHaveAttribute('aria-label', /track\.mp3/)
  await focusPlaying.click()
  await expect(page.getByTestId('canvas-window-breadcrumb')).toHaveText('track.mp3')
})

test('keeps canvas video paused while mounting and switching canvases', async ({ page }) => {
  const canvas = page.getByTestId('infinite-canvas')
  await canvas.click({ button: 'right', position: { x: 40, y: 40 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()
  const browserWindow = page.getByTestId('canvas-window').first()
  await browserWindow.locator('[data-file-path="Videos"]').click()
  await browserWindow.locator('[data-file-path="Videos/sample.mp4"]').click()

  const videoWindow = page.getByTestId('canvas-window').filter({ has: page.locator('video') })
  const video = videoWindow.locator('video')
  await expect(video).toBeVisible()
  await expect
    .poll(async () => video.evaluate((element: HTMLVideoElement) => element.readyState))
    .toBeGreaterThanOrEqual(2)
  await expect
    .poll(async () => video.evaluate((element: HTMLVideoElement) => element.paused))
    .toBe(true)
  await expect(videoWindow.getByTitle('Listen only')).toHaveCount(0)

  const canvasBox = await canvas.boundingBox()
  const videoBox = await videoWindow.boundingBox()
  if (!canvasBox || !videoBox) throw new Error('Canvas video window not laid out')
  expect(videoBox.x).toBeGreaterThanOrEqual(canvasBox.x)
  expect(videoBox.y).toBeGreaterThanOrEqual(canvasBox.y)
  expect(videoBox.x + videoBox.width).toBeLessThanOrEqual(canvasBox.x + canvasBox.width)
  expect(videoBox.y + videoBox.height).toBeLessThanOrEqual(canvasBox.y + canvasBox.height)

  await page.getByTestId('canvas-name-trigger').click()
  await page.getByRole('button', { name: 'New canvas' }).click()
  await page.getByLabel('Name').fill('Other canvas')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByTestId('canvas-name-trigger').click()
  await page.getByRole('button', { name: 'Untitled canvas', exact: true }).click()
  await expect(
    page.getByTestId('canvas-window').filter({ has: page.locator('video') }),
  ).toBeVisible()
  await expect
    .poll(async () => page.locator('video').evaluate((element: HTMLVideoElement) => element.paused))
    .toBe(true)
})

test('offers retry and download when canvas video fails', async ({ page }) => {
  const canvas = page.getByTestId('infinite-canvas')
  await canvas.click({ button: 'right', position: { x: 40, y: 40 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()
  const browserWindow = page.getByTestId('canvas-window').first()
  await browserWindow.locator('[data-file-path="Videos"]').click()
  await browserWindow.locator('[data-file-path="Videos/sample.mp4"]').click()

  const videoWindow = page.getByTestId('canvas-window').filter({ has: page.locator('video') })
  await videoWindow
    .locator('video')
    .evaluate((element) => element.dispatchEvent(new Event('error')))
  await expect(videoWindow.getByText(/Playback failed/)).toBeVisible()
  await expect(videoWindow.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(videoWindow.getByRole('link', { name: 'Download' })).toBeVisible()
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
  await canvas.click({ button: 'right', position: { x: 1000, y: 580 } })
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

  await canvas.click({ button: 'right', position: { x: 900, y: 650 } })
  await expect(page.locator('[data-canvas-context-menu]')).toBeVisible()
  await window.click({ position: { x: 120, y: 100 } })
  await expect(page.locator('[data-canvas-context-menu]')).toBeHidden()

  await canvas.click({ button: 'right', position: { x: 900, y: 650 } })
  await expect(page.locator('[data-canvas-context-menu]')).toBeVisible()
  const box = await window.boundingBox()
  if (!box) throw new Error('Canvas window not laid out')
  await page.mouse.move(box.x + 120, box.y + 16)
  await page.mouse.down()
  await expect(page.locator('[data-canvas-context-menu]')).toBeHidden()
  await page.mouse.up()
})

test('auto-pans canvas while dragging a window near viewport edge', async ({ page }) => {
  const canvas = page.getByTestId('infinite-canvas')
  await canvas.click({ button: 'right', position: { x: 240, y: 160 } })
  await page.getByRole('button', { name: 'Open file browser' }).click()

  const canvasBox = await canvas.boundingBox()
  const window = page.getByTestId('canvas-window')
  const windowBox = await window.boundingBox()
  if (!canvasBox || !windowBox) throw new Error('Canvas window not laid out')

  const grabX = windowBox.x + 120
  const grabY = windowBox.y + 16
  await page.mouse.move(grabX, grabY)
  await page.mouse.down()
  await page.mouse.move(canvasBox.x + canvasBox.width - 2, grabY)

  const world = page.getByTestId('canvas-world')
  const cameraBefore = await world.evaluate(
    (element) => new DOMMatrix(getComputedStyle(element).transform).e,
  )
  const draggedBefore = await window.boundingBox()
  await page.waitForTimeout(300)
  await page.mouse.up()
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
  const cameraAfter = await world.evaluate(
    (element) => new DOMMatrix(getComputedStyle(element).transform).e,
  )
  const draggedAfter = await window.boundingBox()

  expect(cameraAfter).toBeLessThan(cameraBefore - 100)
  expect(Math.abs((draggedAfter?.x ?? 0) - (draggedBefore?.x ?? 0))).toBeLessThan(20)
})
