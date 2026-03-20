import { test, expect, type Page } from '@playwright/test'

async function gotoWorkspace(page: Page) {
  await page.goto('/workspace')
  await expect(page.locator('[data-window-group]')).toBeVisible()
}

function getWindowGroups(page: Page) {
  return page.locator('[data-window-group]')
}

function getBrowserContent(page: Page) {
  return getWindowGroups(page).first().locator('.workspace-window-content')
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

test.describe('Workspace File Browser', () => {
  test('navigates back via breadcrumbs', async ({ page }) => {
    await gotoWorkspace(page)
    const content = getBrowserContent(page)

    await content.getByText('Documents', { exact: true }).click()
    await expect(content.getByText('readme.txt')).toBeVisible()

    await content.getByRole('button', { name: 'Home' }).click()
    await Promise.all(
      ['Videos', 'Music', 'Images', 'Documents'].map((folder) =>
        expect(content.getByText(folder, { exact: true })).toBeVisible(),
      ),
    )
  })

  test('navigates to parent using ".." row', async ({ page }) => {
    await gotoWorkspace(page)
    const content = getBrowserContent(page)

    await content.getByText('Videos', { exact: true }).click()
    await expect(content.getByText('sample.mp4')).toBeVisible()

    await content.getByText('..').first().click()
    await expect(content.getByText('Videos', { exact: true })).toBeVisible()
  })

  test('navigates into nested folders', async ({ page }) => {
    await gotoWorkspace(page)
    const content = getBrowserContent(page)

    await content.getByText('Notes', { exact: true }).click()
    const subfolderRow = content.locator('table').getByText('subfolder', { exact: true })
    await expect(subfolderRow).toBeVisible()

    await subfolderRow.click()
    await expect(content.locator('table').getByText('nested-note.md')).toBeVisible()
  })

  test('switches to grid view and back', async ({ page }) => {
    await gotoWorkspace(page)
    const content = getBrowserContent(page)

    await content.getByText('Videos', { exact: true }).click()
    await expect(content.getByText('sample.mp4')).toBeVisible()

    const listBtn = content.locator('button:has(.lucide-list)')
    if (
      await content
        .locator('table')
        .isVisible()
        .catch(() => false)
    ) {
      // Already in list mode
    } else {
      await listBtn.click()
    }
    await expect(content.locator('table')).toBeVisible()

    await content.locator('button:has(.lucide-layout-grid)').click()
    await expect(content.locator('table')).not.toBeVisible()
    await expect(content.getByText('sample.mp4')).toBeVisible()

    await listBtn.click()
    await expect(content.locator('table')).toBeVisible()
  })

  test('shows file metadata in list view', async ({ page }) => {
    await gotoWorkspace(page)
    const content = getBrowserContent(page)

    await content.getByText('Documents', { exact: true }).click()
    const row = content.locator('table tr').filter({ hasText: 'readme.txt' })
    await expect(row).toBeVisible()
    await expect(row).toContainText(/\d+\s*(B|KB|MB)/)
  })

  test('unsupported file dialog is contained inside file browser window', async ({ page }) => {
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

test.describe('Workspace Image Viewer', () => {
  test('opens image and shows it', async ({ page }) => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Images', 'photo.jpg')
    await expect(viewer.locator('img[alt="photo.jpg"]')).toBeVisible()
  })

  test('shows zoom controls', async ({ page }) => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Images', 'photo.jpg')
    await expect(viewer.locator('button:has(.lucide-zoom-in)')).toBeVisible()
    await expect(viewer.locator('button:has(.lucide-zoom-out)')).toBeVisible()
    await expect(viewer.getByText('Fit')).toBeVisible()
  })

  test('zooms in and out on button click', async ({ page }) => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Images', 'photo.jpg')
    await expect(viewer.getByText('Fit')).toBeVisible()

    await viewer.locator('button:has(.lucide-zoom-in)').click()
    await expect(viewer.getByText('125%')).toBeVisible()

    await viewer.locator('button:has(.lucide-zoom-out)').click()
    await expect(viewer.getByText('Fit').or(viewer.getByText('100%'))).toBeVisible()
  })

  test('rotates image via rotate button', async ({ page }) => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Images', 'photo.jpg')
    const img = viewer.locator('img[alt="photo.jpg"]')
    await expect(img).toBeVisible()

    await viewer.locator('button:has(.lucide-rotate-cw)').click()
    const transform = await img.evaluate((el) => el.style.transform)
    expect(transform).toContain('rotate(90deg)')
  })

  test('fit-to-screen resets zoom and rotation', async ({ page }) => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Images', 'photo.jpg')

    await viewer.locator('button:has(.lucide-zoom-in)').click()
    await viewer.locator('button:has(.lucide-rotate-cw)').click()

    await viewer.locator('button[title="Fit to screen"]').click()
    await expect(viewer.getByText('Fit')).toBeVisible()
    const img = viewer.locator('img[alt="photo.jpg"]')
    const transform = await img.evaluate((el) => el.style.transform)
    expect(transform).toContain('rotate(0deg)')
  })

  test('shows image counter', async ({ page }) => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Images', 'photo.jpg')
    await expect(viewer.getByText('1 of 2')).toBeVisible()
  })

  test('navigates to next image via keyboard', async ({ page }) => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Images', 'photo.jpg')
    await expect(viewer.locator('img[alt="photo.jpg"]')).toBeVisible()
    await expect(viewer.getByText('1 of 2')).toBeVisible()

    await viewer.click()
    await page.keyboard.press('ArrowRight')
    const nextViewer = getWindowGroups(page).last().locator('.workspace-window-content')
    await expect(nextViewer.locator('img[alt="photo.png"]')).toBeVisible()
    await expect(nextViewer.getByText('2 of 2')).toBeVisible()
  })

  test('navigates to previous image via keyboard', async ({ page }) => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Images', 'photo.png')
    await expect(viewer.locator('img[alt="photo.png"]')).toBeVisible()

    await viewer.click()
    await page.keyboard.press('ArrowLeft')
    const prevViewer = getWindowGroups(page).last().locator('.workspace-window-content')
    await expect(prevViewer.locator('img[alt="photo.jpg"]')).toBeVisible()
  })
})

test.describe('Workspace PDF Viewer', () => {
  test('opens PDF embed', async ({ page }) => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Documents', 'sample.pdf')
    await expect(viewer.locator('embed[type="application/pdf"]')).toBeVisible()
  })

  test('shows download button', async ({ page }) => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Documents', 'sample.pdf')
    await expect(viewer.locator('button[title="Download"]')).toBeVisible()
  })

  test('shows open-in-new-tab button', async ({ page }) => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Documents', 'sample.pdf')
    await expect(viewer.locator('button[title="Open in new tab"]')).toBeVisible()
  })
})

test.describe('Workspace Text Viewer', () => {
  test('displays text content', async ({ page }) => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Documents', 'readme.txt')
    await expect(viewer.getByText('This is a test readme file')).toBeVisible()
  })

  test('shows file type and line count', async ({ page }) => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Documents', 'readme.txt')
    await expect(viewer.getByText('TXT')).toBeVisible()
    await expect(viewer.getByText(/\d+ lines/)).toBeVisible()
  })

  test('does not show edit button for non-editable folders', async ({ page }) => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Documents', 'readme.txt')
    await expect(viewer.getByText('This is a test readme file')).toBeVisible()
    await expect(viewer.getByRole('button', { name: 'Edit' })).not.toBeVisible()
  })

  test('copy button exists', async ({ page }) => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Documents', 'readme.txt')
    await expect(viewer.locator('button[title="Copy to clipboard"]')).toBeVisible()
  })

  test('displays JSON files', async ({ page }) => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Documents', 'data.json')
    await expect(viewer.getByText('"name"')).toBeVisible()
    await expect(viewer.getByText('"test"')).toBeVisible()
  })

  test('renders markdown headings and formatting', async ({ page }) => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Documents', 'notes.md')
    await expect(viewer.locator('h1:has-text("Test Notes")')).toBeVisible()
    await expect(viewer.locator('strong:has-text("markdown")')).toBeVisible()
  })

  test('markdown image click opens fullscreen overlay within window', async ({ page }) => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Documents', 'image-note.md')
    const img = viewer.locator('img[alt="photo"]')
    await expect(img).toBeVisible()
    await img.click()
    const overlay = viewer.locator('[role="dialog"][aria-label="View image fullscreen"]')
    await expect(overlay).toBeVisible()
  })

  test('markdown image fullscreen closes on Escape', async ({ page }) => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Documents', 'image-note.md')
    await viewer.locator('img[alt="photo"]').click()
    const overlay = viewer.locator('[role="dialog"][aria-label="View image fullscreen"]')
    await expect(overlay).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(overlay).not.toBeVisible()
  })

  test('markdown image fullscreen closes on backdrop click', async ({ page }) => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Documents', 'image-note.md')
    await viewer.locator('img[alt="photo"]').click()
    const overlay = viewer.locator('[role="dialog"][aria-label="View image fullscreen"]')
    await expect(overlay).toBeVisible()
    await overlay.click({ position: { x: 10, y: 10 } })
    await expect(overlay).not.toBeVisible()
  })

  test('markdown image fullscreen closes on close button', async ({ page }) => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Documents', 'image-note.md')
    await viewer.locator('img[alt="photo"]').click()
    const overlay = viewer.locator('[role="dialog"][aria-label="View image fullscreen"]')
    await expect(overlay).toBeVisible()
    await overlay.getByRole('button', { name: 'Close' }).click()
    await expect(overlay).not.toBeVisible()
  })

  test('auto-enters edit mode in editable folders', async ({ page }) => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Notes', 'todo.md')
    await expect(viewer.locator('textarea')).toBeVisible()
    await expect(viewer.getByRole('button', { name: 'Read only' })).toBeVisible()
  })

  test('shows textarea with file content in edit mode', async ({ page }) => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Notes', 'todo.md')
    await expect(viewer.locator('textarea')).toBeVisible()
    const content = await viewer.locator('textarea').inputValue()
    expect(content).toContain('Todo List')
  })

  test('switches between edit and read-only mode', async ({ page }) => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Notes', 'todo.md')
    await expect(viewer.locator('textarea')).toBeVisible()

    await viewer.getByRole('button', { name: 'Read only' }).click()
    await expect(viewer.locator('textarea')).not.toBeVisible()
    await expect(viewer.locator('h1:has-text("Todo List")')).toBeVisible()

    await viewer.getByRole('button', { name: 'Edit' }).click()
    await expect(viewer.locator('textarea')).toBeVisible()
  })

  test('saves edits and persists changes', async ({ page }) => {
    await gotoWorkspace(page)
    const viewer = await openFileFromBrowser(page, 'Notes', 'todo.md')
    const textarea = viewer.locator('textarea')
    await expect(textarea).toBeVisible({ timeout: 10_000 })

    await textarea.fill('# Updated Todo\n\n- Brand new item\n')

    const viewerWindow = page
      .locator('[data-window-group]')
      .filter({ has: page.locator('.workspace-window-content').locator('textarea') })
      .first()
    await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/api/files/edit') && resp.status() === 200,
      ),
      viewerWindow.locator('[data-testid="window-drag-handle"]').click(),
    ])

    const closeBtn = viewerWindow.locator('.workspace-window-buttons button:has(.lucide-x)')
    await closeBtn.click()
    await expect(getWindowGroups(page)).toHaveCount(1)

    const content = getBrowserContent(page)
    await content.locator('table').getByText('todo.md').click()
    await expect(getWindowGroups(page)).toHaveCount(2)

    const newViewer = page
      .locator('[data-window-group]')
      .filter({ has: page.locator('.workspace-window-content textarea') })
      .first()
      .locator('.workspace-window-content')
    await expect(newViewer.locator('textarea')).toBeVisible({ timeout: 10_000 })
    const saved = await newViewer.locator('textarea').inputValue()
    expect(saved).toContain('Updated Todo')
    expect(saved).toContain('Brand new item')

    await newViewer
      .locator('textarea')
      .fill('# Todo List\n\n- [ ] First task\n- [ ] Second task\n- [x] Done task\n')
    await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/api/files/edit') && resp.status() === 200,
      ),
      getWindowGroups(page).nth(1).locator('[data-testid="window-drag-handle"]').click(),
    ])
  })
})
