import {
  test,
  expect,
  type BrowserContext,
  type Locator,
  type Page,
  type Response,
} from '@playwright/test'
import { getWindowGroups, gotoWorkspace } from './workspace-layout-helpers'
import { createWorkspaceE2EContext, workspaceE2EOrigin } from './workspace-e2e-context'

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

function getBrowserContent(page: Page) {
  return getWindowGroups(page).first().locator('.workspace-window-content')
}

function getMarkdownEditor(container: Locator) {
  return container.getByRole('textbox', { name: / Markdown editor$/ })
}

function getMarkdownDocument(container: Locator) {
  return container.getByRole('document', { name: / Markdown document$/ })
}

async function copyMarkdownSource(page: Page, markdown: Locator): Promise<string> {
  await markdown.focus()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Control+c')
  return page.evaluate(() => navigator.clipboard.readText())
}

async function openFileFromBrowser(page: Page, folder: string, fileName: string) {
  const content = getBrowserContent(page)
  await content.getByText(folder, { exact: true }).click()
  const fileRow = content.locator('table').getByText(fileName)
  await expect(fileRow).toBeVisible()
  await fileRow.click()
  await expect(getWindowGroups(page)).toHaveCount(2)
  return getWindowGroups(page).nth(1).locator('.workspace-window-content')
}

function uniqueWorkspaceMarkdownPath(prefix: string) {
  const fileName = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.md`
  return { fileName, filePath: `MediaContent/${fileName}` }
}

async function createWorkspaceMarkdown(filePath: string, content: string) {
  const response = await sharedContext.request.post(`${workspaceE2EOrigin()}/api/files/create`, {
    data: { type: 'file', path: filePath, content },
  })
  expect(response.ok()).toBe(true)
}

async function readWorkspaceMarkdown(filePath: string) {
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/')
  const response = await sharedContext.request.get(
    `${workspaceE2EOrigin()}/api/media/${encodedPath}`,
  )
  expect(response.ok()).toBe(true)
  return response.text()
}

async function deleteWorkspaceMarkdown(filePath: string) {
  await sharedContext.request.post(`${workspaceE2EOrigin()}/api/files/delete`, {
    data: { path: filePath },
  })
}

test.describe('Workspace File Browser', () => {
  test('navigation: breadcrumbs, parent row, and nested folders', async () => {
    await test.step('navigates back via breadcrumbs', async () => {
      await gotoWorkspace(page)
      const content = getBrowserContent(page)
      await content.getByText('Documents', { exact: true }).click()
      await expect(content.getByText('readme.txt')).toBeVisible()
      await content.getByRole('button', { name: 'Home' }).click()
      const table = content.locator('table')
      await Promise.all(
        ['Videos', 'Music', 'Images', 'Documents'].map((folder) =>
          expect(table.getByText(folder, { exact: true })).toBeVisible(),
        ),
      )
    })

    await test.step('navigates to parent using ".." row', async () => {
      await gotoWorkspace(page)
      const content = getBrowserContent(page)
      await content.getByText('Videos', { exact: true }).click()
      await expect(content.getByText('sample.mp4')).toBeVisible()
      await content.getByText('..').first().click()
      await expect(content.getByText('Videos', { exact: true })).toBeVisible()
    })

    await test.step('navigates into nested folders', async () => {
      await gotoWorkspace(page)
      const content = getBrowserContent(page)
      await content.getByText('Notes', { exact: true }).click()
      const subfolderRow = content.locator('table').getByText('subfolder', { exact: true })
      await expect(subfolderRow).toBeVisible()
      await subfolderRow.click()
      await expect(content.locator('table').getByText('nested-note.md')).toBeVisible()
    })
  })

  test('context menus: row Set icon and breadcrumb Set icon', async () => {
    await test.step('workspace browser row context menu includes Set icon', async () => {
      await gotoWorkspace(page)
      const content = getBrowserContent(page)
      await content
        .locator('table')
        .getByText('Documents', { exact: true })
        .click({ button: 'right' })
      await expect(
        page.locator('[data-slot="file-row-context-menu"]').getByText('Set icon'),
      ).toBeVisible()
    })

    await test.step('workspace breadcrumb folder context menu includes Set icon', async () => {
      await gotoWorkspace(page)
      const content = getBrowserContent(page)
      await content.getByText('Notes', { exact: true }).click()
      await content.locator('table').getByText('subfolder', { exact: true }).click()
      await expect(content.locator('table').getByText('nested-note.md')).toBeVisible()
      let notesBreadcrumb = content.locator('[data-breadcrumb-path="Notes"]')
      if ((await notesBreadcrumb.count()) === 0) {
        await content.locator('[data-breadcrumb-segment="path-picker"]').click()
        notesBreadcrumb = page
          .getByTestId('breadcrumb-path-menu')
          .locator('[data-breadcrumb-path="Notes"]')
      }
      await notesBreadcrumb.dispatchEvent('contextmenu')
      await expect(page.getByTestId('breadcrumb-menu-set-icon')).toBeVisible()
    })
  })

  test('workspace browser shows KB recent strip, search, and inline create in Notes', async () => {
    await gotoWorkspace(page)
    const content = getBrowserContent(page)
    const notesRow = content.locator('table').getByText('Notes', { exact: true })
    await expect(notesRow).toBeVisible()
    await notesRow.click()
    await expect(content.getByTestId('kb-recent-strip')).toBeVisible()
    await expect(content.getByRole('button', { name: 'Search note contents' })).toBeVisible()
    await content.getByRole('button', { name: 'Search note contents' }).click()
    await expect(page.getByPlaceholder('Search notes...')).toBeVisible()
    await expect(content.locator('table')).toBeVisible()
    await expect(content.getByRole('button', { name: 'New file', exact: true })).toBeVisible()
    await expect(content.getByRole('button', { name: 'New folder', exact: true })).toBeVisible()
  })

  test('switches to grid view and back', async () => {
    await gotoWorkspace(page)
    const content = getBrowserContent(page)

    await content.getByText('Videos', { exact: true }).click()
    await expect(content.getByText('sample.mp4')).toBeVisible()

    if (
      await content
        .locator('table')
        .isVisible()
        .catch(() => false)
    ) {
      // Already in list mode
    } else {
      await content.getByRole('button', { name: 'Display options' }).click()
      await content.getByRole('menuitem', { name: 'List view' }).click()
    }
    await expect(content.locator('table')).toBeVisible()

    await content.getByRole('button', { name: 'Display options' }).click()
    await content.getByRole('menuitem', { name: 'Grid view' }).click()
    await expect(content.locator('table')).not.toBeVisible()
    await expect(content.getByText('sample.mp4')).toBeVisible()

    await content.getByRole('button', { name: 'Display options' }).click()
    await content.getByRole('menuitem', { name: 'List view' }).click()
    await expect(content.locator('table')).toBeVisible()
  })

  test('shows file metadata in list view', async () => {
    await gotoWorkspace(page)
    const content = getBrowserContent(page)

    await content.getByText('Documents', { exact: true }).click()
    const row = content.locator('table tr').filter({ hasText: 'readme.txt' })
    await expect(row).toBeVisible()
    await expect(row).toContainText(/\d+\s*(B|KB|MB)/)
  })

  test('keeps headerless list and horizontal scrollbar at window bottom', async () => {
    await gotoWorkspace(page)
    const content = getBrowserContent(page)
    const table = content.locator('table')
    await expect(table).toBeVisible()

    const metrics = await table.evaluate((element) => {
      element.style.minWidth = '1200px'
      const tableContainer = element.parentElement
      let scrollHost: HTMLElement | null = tableContainer
      while (scrollHost && getComputedStyle(scrollHost).overflowX !== 'auto') {
        scrollHost = scrollHost.parentElement
      }
      const dropZone = element.closest<HTMLElement>('[data-testid="workspace-upload-drop-zone"]')
      return {
        hasHeader: !!element.querySelector('thead'),
        scrollBottom: scrollHost?.getBoundingClientRect().bottom ?? 0,
        dropZoneBottom: dropZone?.getBoundingClientRect().bottom ?? 0,
        scrollWidth: scrollHost?.scrollWidth ?? 0,
        clientWidth: scrollHost?.clientWidth ?? 0,
      }
    })

    expect(metrics.hasHeader).toBe(false)
    expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth)
    expect(Math.abs(metrics.scrollBottom - metrics.dropZoneBottom)).toBeLessThanOrEqual(1)
  })

  test('unsupported file dialog is contained inside file browser window', async () => {
    await gotoWorkspace(page)
    const content = getBrowserContent(page)
    await content.getByText('Documents', { exact: true }).click()
    await content.locator('table').getByText('unsupported.xyz').click()
    await page.waitForTimeout(100)

    const dialogMessage = page.getByText('This file type cannot be previewed.')
    await expect(dialogMessage).toBeVisible()
    const windowGroup = getWindowGroups(page).first()
    await expect(windowGroup.locator('text=This file type cannot be previewed.')).toBeVisible()
  })
})

test.describe('Workspace clipboard paste', () => {
  test('paste in Notes creates file and opens viewer with clipboard text', async () => {
    await gotoWorkspace(page)
    const content = getBrowserContent(page)
    await content.locator('table').getByText('Notes', { exact: true }).click()
    const dropZone = content.getByTestId('workspace-upload-drop-zone')
    await dropZone.focus()
    const marker = `ws paste e2e ${Date.now()}`
    await page.evaluate(async (text) => {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ])
    }, marker)
    await page.keyboard.press('Control+v')
    await expect(page.getByRole('heading', { name: /Paste Text/i })).toBeVisible()
    await page.getByRole('button', { name: 'Paste' }).click()
    await expect(getWindowGroups(page)).toHaveCount(2)
    const viewer = getWindowGroups(page).nth(1).locator('.workspace-window-content')
    const editor = getMarkdownEditor(viewer)
    await expect(editor).toBeVisible({ timeout: 10_000 })
    expect(await copyMarkdownSource(page, editor)).toBe(marker)
  })
})

test.describe('Workspace Image Viewer', () => {
  test('image viewer: controls, fit, counter, and keyboard navigation', async () => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Images', 'photo.jpg')

    await test.step('shows image and zoom controls', async () => {
      await expect(viewer.locator('img[alt="photo.jpg"]')).toBeVisible()
      await expect(viewer.locator('button:has(.lucide-zoom-in)')).toBeVisible()
      await expect(viewer.locator('button:has(.lucide-zoom-out)')).toBeVisible()
      await expect(viewer.getByText('Fit')).toBeVisible()
      await expect(viewer.getByRole('button', { name: 'Previous image' })).toBeVisible()
      await expect(viewer.getByRole('button', { name: 'Next image' })).toBeVisible()
    })

    await test.step('zooms in and out on button click', async () => {
      await expect(viewer.getByText('Fit')).toBeVisible()
      await viewer.locator('button:has(.lucide-zoom-in)').click()
      await expect(viewer.getByText('125%')).toBeVisible()
      await viewer.locator('button:has(.lucide-zoom-out)').click()
      await expect(viewer.getByText('Fit').or(viewer.getByText('100%'))).toBeVisible()
    })

    await test.step('rotates image via rotate button', async () => {
      const img = viewer.locator('img[alt="photo.jpg"]')
      await expect(img).toBeVisible()
      const rotateButton = viewer.locator('button:has(.lucide-rotate-cw)')
      await rotateButton.click()
      expect(await img.evaluate((el) => el.style.transform)).toContain('rotate(90deg)')
      const surfaceBox = (await viewer.getByTestId('workspace-image-surface').boundingBox())!
      const imageBox = (await img.boundingBox())!
      expect(imageBox.x).toBeGreaterThanOrEqual(surfaceBox.x)
      expect(imageBox.y).toBeGreaterThanOrEqual(surfaceBox.y)
      expect(imageBox.x + imageBox.width).toBeLessThanOrEqual(surfaceBox.x + surfaceBox.width)
      expect(imageBox.y + imageBox.height).toBeLessThanOrEqual(surfaceBox.y + surfaceBox.height)

      await rotateButton.click({ clickCount: 3 })
      expect(await img.evaluate((el) => el.style.transform)).toContain('rotate(0deg)')
    })

    await test.step('fit-to-screen resets zoom and rotation', async () => {
      await viewer.locator('button:has(.lucide-zoom-in)').click()
      await viewer.locator('button:has(.lucide-rotate-cw)').click()
      await viewer.locator('button[title="Fit to screen"]').click()
      await expect(viewer.getByText('Fit')).toBeVisible()
      const img = viewer.locator('img[alt="photo.jpg"]')
      const transform = await img.evaluate((el) => el.style.transform)
      expect(transform).toContain('rotate(0deg)')
    })

    await test.step('shows image counter and navigates to next via keyboard', async () => {
      await expect(viewer.getByText('1 of 2')).toBeVisible()
      await viewer.click()
      await page.keyboard.press('ArrowRight')
      const nextViewer = getWindowGroups(page).last().locator('.workspace-window-content')
      await expect(nextViewer.locator('img[alt="photo.png"]')).toBeVisible()
      await expect(nextViewer.getByText('2 of 2')).toBeVisible()
    })

    await test.step('navigates to previous image via keyboard from photo.png', async () => {
      await gotoWorkspace(page)
      const viewerPng = await openFileFromBrowser(page, 'Images', 'photo.png')
      await expect(viewerPng.locator('img[alt="photo.png"]')).toBeVisible()
      await viewerPng.click()
      await page.keyboard.press('ArrowLeft')
      const prevViewer = getWindowGroups(page).last().locator('.workspace-window-content')
      await expect(prevViewer.locator('img[alt="photo.jpg"]')).toBeVisible()
    })
  })

  test('image viewer: arrow keys do not navigate while a search field is focused', async () => {
    await gotoWorkspace(page)
    await openFileFromBrowser(page, 'Images', 'photo.jpg')
    const viewer = getWindowGroups(page).nth(1).locator('.workspace-window-content')
    await expect(viewer.locator('img[alt="photo.jpg"]')).toBeVisible()
    await expect(viewer.getByText('1 of 2')).toBeVisible()

    const browserGroup = getWindowGroups(page).first()
    await browserGroup.locator('[data-workspace-tab-id]').first().click()
    const browser = getBrowserContent(page)
    await browser.getByRole('button', { name: 'Home' }).click()
    await browser.getByText('Notes', { exact: true }).click()
    await browser.getByRole('button', { name: 'Search note contents' }).click()
    const search = page.getByPlaceholder('Search notes...')
    await expect(search).toBeVisible()
    await search.focus()
    await page.keyboard.press('ArrowRight')

    await expect(viewer.locator('img[alt="photo.jpg"]')).toBeVisible()
    await expect(viewer.getByText('1 of 2')).toBeVisible()
  })

  test('image viewer: desktop scroll wheel navigation', async () => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Images', 'photo.jpg')
    await expect(viewer.getByText('1 of 2')).toBeVisible()

    await viewer.getByTestId('workspace-image-surface').hover()
    await page.mouse.wheel(0, 100)
    await expect(viewer.locator('img[alt="photo.png"]')).toBeVisible()

    await page.waitForTimeout(300)
    await page.mouse.wheel(0, -100)
    await expect(viewer.locator('img[alt="photo.jpg"]')).toBeVisible()
  })
})

test.describe('Workspace PDF Viewer', () => {
  test('opens image folders in a reader window with image selection active', async () => {
    await gotoWorkspace(page)
    const browser = getBrowserContent(page)
    await browser.getByText('Images', { exact: true }).click({ button: 'right' })
    await page.getByTestId('open-with-menu').click()
    await expect(page.getByTestId('open-with-submenu')).toBeVisible()
    await page.getByTestId('open-with-reader').click()

    await expect(getWindowGroups(page)).toHaveCount(2)
    const readerWindow = getWindowGroups(page).nth(1)
    await expect(readerWindow.getByTestId('reader-dialog')).toBeVisible()
    await expect(readerWindow.locator('svg.lucide-book-open').first()).toBeVisible()
    await expect(readerWindow.locator('svg.lucide-folder')).toHaveCount(0)
    await expect(readerWindow.getByTestId('reader-image-page')).toHaveCount(2)
    await expect(readerWindow.getByTestId('region-layer').first()).toHaveCSS(
      'pointer-events',
      'auto',
    )
    await expect(page.locator('body > [data-testid="reader-dialog"]')).toHaveCount(0)

    await page.reload()

    await expect(getWindowGroups(page)).toHaveCount(2)
    const restoredReaderWindow = getWindowGroups(page).nth(1)
    await expect(restoredReaderWindow.getByTestId('reader-dialog')).toBeVisible()
    await expect(restoredReaderWindow.locator('svg.lucide-book-open').first()).toBeVisible()
    await expect(restoredReaderWindow.locator('svg.lucide-folder')).toHaveCount(0)
    await expect(restoredReaderWindow.getByTestId('reader-image-page')).toHaveCount(2)
    await expect(restoredReaderWindow.getByText('This file type cannot be previewed.')).toHaveCount(
      0,
    )
  })

  test('keeps two readers independent and hands fullscreen between them', async () => {
    await page.addInitScript(() => {
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get: () => Reflect.get(document, '__testFullscreenElement') as Element | null,
      })
      HTMLElement.prototype.requestFullscreen = async function () {
        Reflect.set(document, '__testFullscreenElement', this)
        document.dispatchEvent(new Event('fullscreenchange'))
      }
      document.exitFullscreen = async () => {
        Reflect.set(document, '__testFullscreenElement', null)
        document.dispatchEvent(new Event('fullscreenchange'))
      }
    })
    await gotoWorkspace(page)
    const browser = getBrowserContent(page)
    await browser.getByText('Documents', { exact: true }).click()
    await browser.locator('table').getByText('reader-workspace.pdf').click()
    await expect(getWindowGroups(page)).toHaveCount(2)
    await browser
      .locator('table')
      .getByText('sample.pdf')
      .evaluate((row) => (row as HTMLElement).click())
    await expect(getWindowGroups(page)).toHaveCount(3)

    const readers = page.getByTestId('reader-dialog')
    await expect(readers).toHaveCount(2)
    await expect(readers.nth(0).getByTestId('reader-page-indicator')).toContainText('Page 1 / 4')
    await expect(readers.nth(1).getByTestId('reader-page-indicator')).toContainText('Page 1 / 1')
    await readers
      .nth(0)
      .getByTestId('reader-viewport')
      .evaluate((viewport) => {
        viewport.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      })
    await page.keyboard.press('ArrowRight')
    await expect(readers.nth(0).getByTestId('reader-page-indicator')).toContainText('Page 2 / 4')
    await expect(readers.nth(1).getByTestId('reader-page-indicator')).toContainText('Page 1 / 1')
    await readers
      .nth(0)
      .getByRole('button', { name: 'Enter fullscreen' })
      .evaluate((button) => (button as HTMLElement).click())
    await expect(readers.nth(0).getByRole('button', { name: 'Exit fullscreen' })).toBeVisible()
    await expect(readers.nth(1).getByRole('button', { name: 'Enter fullscreen' })).toBeVisible()

    await readers
      .nth(1)
      .getByRole('button', { name: 'Enter fullscreen' })
      .evaluate((button) => (button as HTMLElement).click())
    await expect(readers.nth(0).getByRole('button', { name: 'Enter fullscreen' })).toBeVisible()
    await expect(readers.nth(1).getByRole('button', { name: 'Exit fullscreen' })).toBeVisible()
    const secondIsFullscreen = await readers
      .nth(1)
      .evaluate((reader) => document.fullscreenElement === reader)
    expect(secondIsFullscreen).toBe(true)

    const secondText = readers.nth(1).locator('.textLayer span').filter({ hasText: 'Selectable' })
    await expect(secondText).toBeVisible()
    await secondText.evaluate((span) => {
      const range = document.createRange()
      range.selectNodeContents(span)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      const rect = span.getBoundingClientRect()
      span.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          clientX: rect.right - 2,
          clientY: rect.top + rect.height / 2,
        }),
      )
    })
    const secondMenu = readers.nth(1).getByTestId('reader-selection-menu')
    await expect(secondMenu).toBeVisible()
    const menuInsideSecondReader = await secondMenu.evaluate((menu) => {
      const viewport = menu
        .closest('[data-testid="reader-dialog"]')
        ?.querySelector('[data-testid="reader-viewport"]')
      if (!viewport) return false
      const menuRect = menu.getBoundingClientRect()
      const viewportRect = viewport.getBoundingClientRect()
      return menuRect.top >= viewportRect.top && menuRect.bottom <= viewportRect.bottom
    })
    expect(menuInsideSecondReader).toBe(true)
  })

  test('opens PDF in reader with selection and position controls', async () => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Documents', 'sample.pdf')
    await test.step('opens reader canvas instead of browser PDF embed', async () => {
      await expect(viewer.getByTestId('reader-dialog')).toBeVisible()
      await expect(viewer.getByTestId('pdf-canvas')).toBeVisible()
      await expect(viewer.locator('embed[type="application/pdf"]')).toHaveCount(0)
    })
    await test.step('shows reader settings', async () => {
      await viewer.getByTestId('reader-settings-button').click()
      await expect(viewer.getByTestId('reader-settings')).toContainText('Default action')
      await expect(viewer.getByTestId('reader-settings')).toContainText('Select')
      await viewer.getByRole('button', { name: 'none', exact: true }).click()
    })
    await test.step('opens selection menu from real mouse text selection', async () => {
      const textSpan = viewer.locator('.textLayer span').filter({ hasText: 'Selectable' }).first()
      await expect(textSpan).toBeVisible()
      const bounds = await textSpan.boundingBox()
      if (!bounds) throw new Error('Expected selectable PDF text bounds')
      await textSpan.dblclick({ position: { x: 10, y: bounds.height / 2 } })
      await expect
        .poll(() => page.evaluate(() => window.getSelection()?.toString().trim() ?? ''))
        .not.toBe('')
      await expect(page.getByTestId('reader-selection-menu')).toBeVisible()
      await expect(page.getByTestId('reader-selection-menu')).toContainText('Selectable')
      const verticalAlignment = await page
        .getByRole('textbox', { name: 'Selected text' })
        .evaluate((input) => {
          const field = input.parentElement?.getBoundingClientRect()
          const translate = document
            .querySelector<HTMLElement>('[data-testid="reader-translate"]')
            ?.getBoundingClientRect()
          const define = document
            .querySelector<HTMLElement>('[data-testid="reader-define"]')
            ?.getBoundingClientRect()
          if (!field || !translate || !define) throw new Error('Selection action geometry missing')
          const center = (rect: DOMRect) => rect.top + rect.height / 2
          return {
            translate: center(translate) - center(field),
            define: center(define) - center(field),
          }
        })
      expect(verticalAlignment.translate).toBeCloseTo(0, 1)
      expect(verticalAlignment.define).toBeCloseTo(0, 1)
    })
  })
})

test.describe('Workspace Text Viewer', () => {
  test('edits and saves Markdown outside a knowledge base through workspace browser', async () => {
    const fileName = `workspace-outside-kb-${Date.now()}-${Math.random().toString(36).slice(2)}.md`
    const filePath = `MediaContent/${fileName}`
    const initial = '# Workspace Outside KB\n\nEditable Markdown file.\n'
    const updated = '# Workspace Outside KB Updated\n\nSaved through CodeMirror.\n'
    const origin = workspaceE2EOrigin()
    const createResponse = await sharedContext.request.post(`${origin}/api/files/create`, {
      data: { type: 'file', path: filePath, content: initial },
    })
    expect(createResponse.ok()).toBe(true)

    try {
      await gotoWorkspace(page)
      const viewer = await openFileFromBrowser(page, 'MediaContent', fileName)
      const markdown = viewer.getByTestId('markdown-document')
      const editor = getMarkdownEditor(viewer)

      await expect(markdown).toHaveAttribute('data-mode', 'edit')
      await expect(editor).toBeVisible()
      await expect(markdown.locator('.cm-editor')).toBeVisible()
      await expect(viewer.locator('textarea')).toHaveCount(0)
      expect(await copyMarkdownSource(page, editor)).toBe(initial)

      await editor.fill(updated)
      await Promise.all([
        page.waitForResponse((response) => {
          if (!response.url().includes('/api/files/edit') || response.status() !== 200) return false
          const body = response.request().postDataJSON() as {
            path?: string
          } | null
          return body?.path === filePath
        }),
        editor.press('Control+s'),
      ])

      const encodedPath = filePath.split('/').map(encodeURIComponent).join('/')
      const readResponse = await sharedContext.request.get(`${origin}/api/media/${encodedPath}`)
      expect(readResponse.ok()).toBe(true)
      expect(await readResponse.text()).toBe(updated)
    } finally {
      await sharedContext.request.post(`${origin}/api/files/delete`, {
        data: { path: filePath },
      })
    }
  })

  test('editable Markdown keeps ordinary link clicks in the editor and opens Ctrl+click externally', async () => {
    const { fileName, filePath } = uniqueWorkspaceMarkdownPath('workspace-link-interaction')
    const externalUrl = `https://example.com/workspace-editor-${Date.now()}`
    const source = `# Link interaction\n\n[External target](${externalUrl})\n`
    let popup: Page | undefined
    await createWorkspaceMarkdown(filePath, source)
    await sharedContext.route(externalUrl, async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: '<p>External target</p>',
      })
    })

    try {
      await gotoWorkspace(page)
      const viewer = await openFileFromBrowser(page, 'MediaContent', fileName)
      const document = viewer.getByTestId('markdown-document')
      const editor = getMarkdownEditor(viewer)
      const link = document.getByRole('link', { name: 'External target' })
      const workspaceUrl = page.url()
      const originalPageCount = sharedContext.pages().length

      await expect(editor).toBeVisible()
      await expect(link).toBeVisible()
      await link.click()

      await expect(editor).toBeFocused()
      await expect(page).toHaveURL(workspaceUrl)
      expect(sharedContext.pages()).toHaveLength(originalPageCount)
      expect(await copyMarkdownSource(page, editor)).toBe(source)

      await editor.press('Control+Home')
      await expect(link).toBeVisible()
      const popupPromise = sharedContext.waitForEvent('page')
      await link.click({ modifiers: ['Control'] })
      popup = await popupPromise
      await expect(popup).toHaveURL(externalUrl)

      expect(await readWorkspaceMarkdown(filePath)).toBe(source)
    } finally {
      await popup?.close()
      await sharedContext.unroute(externalUrl)
      await deleteWorkspaceMarkdown(filePath)
    }
  })

  test('editable Markdown image click reveals source and double-click opens fullscreen', async () => {
    const { fileName, filePath } = uniqueWorkspaceMarkdownPath('workspace-image-interaction')
    const imageSource = '![workspace photo](MediaContent/photo.png)'
    const source = `# Image interaction\n\n${imageSource}\n`
    await createWorkspaceMarkdown(filePath, source)

    try {
      await gotoWorkspace(page)
      const viewer = await openFileFromBrowser(page, 'MediaContent', fileName)
      const document = viewer.getByTestId('markdown-document')
      const editor = getMarkdownEditor(viewer)
      const image = document.locator('img.cm-md-image[alt="workspace photo"]')

      await expect(editor).toBeVisible()
      await expect(image).toBeVisible()
      await image.click()
      await expect(document.locator('.cm-md-image-source')).toHaveText(imageSource)
      expect(await copyMarkdownSource(page, editor)).toBe(source)

      await editor.press('Control+Home')
      await expect(image).toBeVisible()
      const imageBox = await image.boundingBox()
      expect(imageBox).not.toBeNull()
      await page.mouse.dblclick(
        imageBox!.x + imageBox!.width / 2,
        imageBox!.y + imageBox!.height / 2,
      )

      const overlay = viewer.locator('[role="dialog"][aria-label="View image fullscreen"]')
      await expect(overlay).toBeVisible()
      await overlay.getByRole('button', { name: 'Close' }).click()
      await expect(overlay).not.toBeVisible()
      expect(await readWorkspaceMarkdown(filePath)).toBe(source)
    } finally {
      await deleteWorkspaceMarkdown(filePath)
    }
  })

  test('refreshes a clean Markdown editor after a remote update', async ({ browser }) => {
    const { fileName, filePath } = uniqueWorkspaceMarkdownPath('workspace-clean-remote')
    const initial = '# Clean remote update\n\nInitial content.\n'
    const remote = '# Clean remote update\n\nRemote replacement.\n'
    const secondContext = await createWorkspaceE2EContext(browser)
    await createWorkspaceMarkdown(filePath, initial)

    try {
      await gotoWorkspace(page)
      const viewer = await openFileFromBrowser(page, 'MediaContent', fileName)
      const editor = getMarkdownEditor(viewer)
      await expect(editor).toBeVisible()
      expect(await copyMarkdownSource(page, editor)).toBe(initial)

      const response = await secondContext.request.post(`${workspaceE2EOrigin()}/api/files/edit`, {
        data: { path: filePath, content: remote },
      })
      expect(response.ok()).toBe(true)

      await expect.poll(() => copyMarkdownSource(page, editor)).toBe(remote)
      await expect(viewer.getByText('This file changed elsewhere.')).toHaveCount(0)
      expect(await readWorkspaceMarkdown(filePath)).toBe(remote)
    } finally {
      await secondContext.close()
      await deleteWorkspaceMarkdown(filePath)
    }
  })

  test('serializes rapid Ctrl+S saves and persists the latest Markdown exactly', async () => {
    const { fileName, filePath } = uniqueWorkspaceMarkdownPath('workspace-save-order')
    const initial = '# Save ordering\n\nInitial.\n'
    const first = '# Save ordering\n\nFirst queued save.\n'
    const latest = '# Save ordering\n\nLatest rapid save.\n'
    let releaseFirstSave = () => {}
    let markFirstSaveStarted = () => {}
    const firstSaveGate = new Promise<void>((resolve) => {
      releaseFirstSave = resolve
    })
    const firstSaveStarted = new Promise<void>((resolve) => {
      markFirstSaveStarted = resolve
    })
    let targetRequestCount = 0
    let completedTargetRequestCount = 0
    const onResponse = (response: Response) => {
      if (!response.url().includes('/api/files/edit') || response.status() !== 200) return
      const body = response.request().postDataJSON() as {
        path?: string
      } | null
      if (body?.path === filePath) completedTargetRequestCount += 1
    }

    await createWorkspaceMarkdown(filePath, initial)
    page.on('response', onResponse)
    await page.route('**/api/files/edit', async (route) => {
      const body = route.request().postDataJSON() as { path?: string } | null
      if (body?.path === filePath) {
        targetRequestCount += 1
        if (targetRequestCount === 1) {
          markFirstSaveStarted()
          await firstSaveGate
        }
      }
      await route.continue()
    })

    try {
      await gotoWorkspace(page)
      const viewer = await openFileFromBrowser(page, 'MediaContent', fileName)
      const editor = getMarkdownEditor(viewer)
      await expect(editor).toBeVisible()
      expect(await copyMarkdownSource(page, editor)).toBe(initial)

      await editor.fill(first)
      await editor.press('Control+s')
      await firstSaveStarted

      await editor.fill(latest)
      await editor.press('Control+s')
      await editor.press('Control+s')
      await page.waitForTimeout(100)
      expect(targetRequestCount).toBe(1)

      releaseFirstSave()
      await expect.poll(() => completedTargetRequestCount).toBe(3)
      await expect.poll(() => readWorkspaceMarkdown(filePath)).toBe(latest)
      expect(await copyMarkdownSource(page, editor)).toBe(latest)
    } finally {
      releaseFirstSave()
      page.off('response', onResponse)
      await page.unroute('**/api/files/edit')
      await deleteWorkspaceMarkdown(filePath)
    }
  })

  test('keeps a dirty KB editor when the file changes from a second context', async ({
    browser,
  }) => {
    const fileName = `conflict-${Date.now()}.md`
    const filePath = `Notes/${fileName}`
    const secondContext = await createWorkspaceE2EContext(browser)
    const origin = workspaceE2EOrigin()
    try {
      await secondContext.request.post(`${origin}/api/files/create`, {
        data: { type: 'file', path: filePath, content: '# Original\n' },
      })
      await gotoWorkspace(page)
      const browserPane = getBrowserContent(page)
      await browserPane.getByText('Notes', { exact: true }).click()
      await browserPane.locator('table').getByText(fileName, { exact: true }).click()

      const viewer = getWindowGroups(page).nth(1).locator('.workspace-window-content')
      const editor = getMarkdownEditor(viewer)
      await expect(editor).toBeVisible()
      expect(await copyMarkdownSource(page, editor)).toBe('# Original\n')
      await editor.fill('# Local dirty edit\n')

      await secondContext.request.post(`${origin}/api/files/edit`, {
        data: { path: filePath, content: '# Remote edit\n' },
      })

      await expect(viewer.getByText('This file changed elsewhere.')).toBeVisible()
      expect(await copyMarkdownSource(page, editor)).toBe('# Local dirty edit\n')
      await viewer.getByRole('button', { name: 'Reload remote version' }).click()
      await expect.poll(() => copyMarkdownSource(page, editor)).toBe('# Remote edit\n')
    } finally {
      await secondContext.request.post(`${origin}/api/files/delete`, {
        data: { path: filePath },
      })
      await secondContext.close()
    }
  })

  test('readme.txt: content, metadata, and read-only toolbar', async () => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Documents', 'readme.txt')
    await test.step('displays text content', async () => {
      await expect(viewer.getByText('This is a test readme file')).toBeVisible()
    })
    await test.step('shows file type and line count', async () => {
      await expect(viewer.getByText('TXT')).toBeVisible()
      await expect(viewer.getByText(/\d+ lines/)).toBeVisible()
    })
    await test.step('does not show edit button for non-editable folders', async () => {
      await expect(viewer.getByRole('button', { name: 'Edit', exact: true })).not.toBeVisible()
    })
    await test.step('copy button exists', async () => {
      await expect(viewer.locator('button[title="Copy to clipboard"]')).toBeVisible()
    })
  })

  test('displays JSON files', async () => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Documents', 'data.json')
    await expect(viewer.getByText('"name"')).toBeVisible()
    await expect(viewer.getByText('"test"')).toBeVisible()
  })

  test('renders markdown headings and formatting', async () => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Documents', 'notes.md')
    const document = getMarkdownDocument(viewer)
    await expect(document).toBeVisible()
    await expect(viewer.locator('.cm-md-heading-1')).toContainText('Test Notes')
    await expect(viewer.locator('.cm-md-strong')).toContainText('markdown')
    await expect(
      viewer.locator('[role="link"][data-markdown-link="https://example.com"]'),
    ).toContainText('a link')
  })

  test('markdown image fullscreen overlay open and close paths', async () => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Documents', 'image-note.md')
    const overlay = viewer.locator('[role="dialog"][aria-label="View image fullscreen"]')

    await test.step('opens fullscreen from image click', async () => {
      const img = viewer.locator('img.cm-md-image[alt="photo"]')
      await expect(img).toBeVisible()
      await img.click()
      await expect(overlay).toBeVisible()
    })

    await test.step('closes on Escape', async () => {
      await page.keyboard.press('Escape')
      await expect(overlay).not.toBeVisible()
    })

    await test.step('closes on backdrop click', async () => {
      await viewer.locator('img.cm-md-image[alt="photo"]').click()
      await expect(overlay).toBeVisible()
      await overlay.click({ position: { x: 10, y: 10 } })
      await expect(overlay).not.toBeVisible()
    })

    await test.step('closes on close button', async () => {
      await viewer.locator('img.cm-md-image[alt="photo"]').click()
      await expect(overlay).toBeVisible()
      await overlay.getByRole('button', { name: 'Close' }).click()
      await expect(overlay).not.toBeVisible()
    })
  })

  test('Notes todo.md: edit mode, content, and read-only toggle', async () => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Notes', 'todo.md')

    await test.step('auto-enters edit mode in editable folders', async () => {
      await expect(getMarkdownEditor(viewer)).toBeVisible()
      await expect(viewer.getByTestId('markdown-document')).toHaveAttribute('data-mode', 'edit')
      await expect(viewer.getByRole('button', { name: 'Read only' })).toBeVisible()
    })

    await test.step('shows editor with exact Markdown source', async () => {
      const content = await copyMarkdownSource(page, getMarkdownEditor(viewer))
      expect(content).toContain('Todo List')
    })

    await test.step('switches one CodeMirror document between edit and read modes', async () => {
      await viewer.getByRole('button', { name: 'Read only' }).click()
      await expect(getMarkdownEditor(viewer)).not.toBeVisible()
      const document = getMarkdownDocument(viewer)
      await expect(document).toBeVisible()
      await expect(viewer.locator('.cm-md-heading-1')).toContainText('Todo List')
      await expect(viewer.locator('input[data-markdown-task="read"]').first()).toBeDisabled()
      expect(await copyMarkdownSource(page, document)).toContain('# Todo List')
      await viewer.getByRole('button', { name: 'Edit', exact: true }).click()
      const editor = getMarkdownEditor(viewer)
      await expect(editor).toBeVisible()
      await editor.press('ArrowRight')
      await expect(viewer.locator('input[data-markdown-task="edit"]').first()).toBeEnabled()
    })
  })

  test('keeps cursor position while typing within existing text', async () => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Notes', 'todo.md')
    const editor = getMarkdownEditor(viewer)
    await expect(editor).toBeVisible()
    const original = await copyMarkdownSource(page, editor)
    const position = original.indexOf('Todo')
    expect(position).toBeGreaterThanOrEqual(0)

    await editor.focus()
    await page.keyboard.press('Control+Home')
    for (let index = 0; index < position; index += 1) await page.keyboard.press('ArrowRight')
    for (const character of 'abcde') await editor.press(character)

    expect(await copyMarkdownSource(page, editor)).toBe(
      `${original.slice(0, position)}abcde${original.slice(position)}`,
    )
    await Promise.all([
      page.waitForResponse(
        (response) => response.url().includes('/api/files/edit') && response.ok(),
      ),
      editor.press('Control+s'),
    ])
    await editor.fill(original)
    await Promise.all([
      page.waitForResponse(
        (response) => response.url().includes('/api/files/edit') && response.ok(),
      ),
      editor.press('Control+s'),
    ])
  })

  test('isolates workspace navigation keys while Markdown editor is focused', async () => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Notes', 'todo.md')
    const editor = getMarkdownEditor(viewer)
    const original = await copyMarkdownSource(page, editor)
    const navigationKeys = [
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
      'PageUp',
      'PageDown',
    ]

    await page.evaluate((keys) => {
      const state = window as typeof window & {
        __markdownBubbledKeys?: string[]
      }
      state.__markdownBubbledKeys = []
      window.addEventListener('keydown', (event) => {
        if (keys.includes(event.key)) state.__markdownBubbledKeys?.push(event.key)
      })
    }, navigationKeys)

    await editor.focus()
    for (const key of navigationKeys) await page.keyboard.press(key)

    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { __markdownBubbledKeys?: string[] }).__markdownBubbledKeys,
      ),
    ).toEqual([])
    expect(await copyMarkdownSource(page, editor)).toBe(original)
    await expect(getWindowGroups(page)).toHaveCount(2)
  })

  test('Ctrl+S saves edits and persists changes', async () => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Notes', 'todo.md')
    const editor = getMarkdownEditor(viewer)
    await expect(editor).toBeVisible({ timeout: 10_000 })

    await editor.fill('# Updated Todo\n\n- Brand new item\n')

    const viewerWindow = getWindowGroups(page).nth(1)
    await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/api/files/edit') && resp.status() === 200,
      ),
      editor.press('Control+s'),
    ])

    const closeBtn = viewerWindow.locator('.workspace-window-buttons button:has(.lucide-x)')
    await closeBtn.click()
    await expect(getWindowGroups(page)).toHaveCount(1)

    const content = getBrowserContent(page)
    await content.locator('table').getByText('todo.md').click()
    await expect(getWindowGroups(page)).toHaveCount(2)

    const newViewer = getWindowGroups(page).nth(1).locator('.workspace-window-content')
    const newEditor = getMarkdownEditor(newViewer)
    await expect(newEditor).toBeVisible({ timeout: 10_000 })
    const saved = await copyMarkdownSource(page, newEditor)
    expect(saved).toContain('Updated Todo')
    expect(saved).toContain('Brand new item')

    await newEditor.fill('# Todo List\n\n- [ ] First task\n- [ ] Second task\n- [x] Done task\n')
    await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/api/files/edit') && resp.status() === 200,
      ),
      getWindowGroups(page).nth(1).locator('[data-testid="window-drag-handle"]').click(),
    ])
  })
})
