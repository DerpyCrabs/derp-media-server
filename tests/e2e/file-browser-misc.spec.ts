import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const batchId = process.env.BATCH_ID
const mediaDir = batchId ? `test-media-${batchId}` : 'test-media'
const UPLOAD_DIR = 'SharedContent'

test.describe('File browser misc', () => {
  test('uploads a folder via upload menu', async ({ page }) => {
    await page.goto(`/?dir=${UPLOAD_DIR}`)
    const tmpRoot = fs.mkdtempSync(path.join(mediaDir, 'upload-dir-'))
    fs.writeFileSync(path.join(tmpRoot, 'folder-root-file.txt'), 'folder upload content')
    try {
      const fileChooserPromise = page.waitForEvent('filechooser')
      await page.locator('button[title="Upload"]').click()
      await page.getByText('Upload folder').click()
      const fileChooser = await fileChooserPromise
      await fileChooser.setFiles(tmpRoot)

      await expect(page.getByText('Upload complete')).toBeVisible({ timeout: 15_000 })
      await expect(page.locator('table').getByText('folder-root-file.txt')).toBeVisible()
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  test('shows drop overlay when dragging files over listing', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'DataTransfer simulation is validated on Chromium')
    await page.goto(`/?dir=${UPLOAD_DIR}`)
    await page.evaluate(() => {
      const zone = document.querySelector('[data-testid="upload-drop-zone"]')
      if (!zone) throw new Error('missing upload-drop-zone')
      const dt = new DataTransfer()
      dt.items.add(new File(['x'], 'ext-drop.txt', { type: 'text/plain' }))
      zone.dispatchEvent(
        new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }),
      )
    })
    await expect(page.getByText('Drop files to upload')).toBeVisible()
  })

  test('persists dark mode after reload', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Open theme settings' }).click()
    await page.getByRole('menuitem', { name: 'Dark' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', /dark/)
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', /dark/)
  })

  test('keeps the complete theme menu accessible inside a short mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 320 })
    await page.goto('/')
    await page.getByRole('button', { name: 'Open theme settings' }).click()
    const menu = page.getByTestId('theme-settings-menu')
    await expect(menu).toBeVisible()
    const box = await menu.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(360)
    expect(box!.y + box!.height).toBeLessThanOrEqual(320)

    await page.getByRole('menuitem', { name: 'Cosmic Night' }).click()
    await expect(menu).not.toBeVisible()
    await page.getByRole('button', { name: 'Open theme settings' }).click()
    await page.getByRole('button', { name: 'Media directories' }).click()
    await expect(page.getByRole('dialog', { name: 'Media directories' })).toBeVisible()
  })

  test('dismisses share dialog with Escape', async ({ page }) => {
    await page.goto('/?dir=Documents')
    await page.locator('table tr').filter({ hasText: 'readme.txt' }).click({ button: 'right' })
    await page
      .locator('[data-slot="context-menu-item"]')
      .getByText(/Share|Manage Share/)
      .click()
    await expect(page.getByRole('heading', { name: 'Share Links' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'Share Links' })).not.toBeVisible()
  })
})

test.describe('File browser clipboard paste', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

  test('opens paste dialog for text clipboard', async ({ page }) => {
    await page.goto(`/?dir=${UPLOAD_DIR}`)
    await page.getByTestId('file-browser').focus()
    await page.evaluate(async () => {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob(['paste dialog e2e'], { type: 'text/plain' }),
        }),
      ])
    })
    await page.keyboard.press('Control+v')
    await expect(page.getByRole('heading', { name: /Paste Text/i })).toBeVisible()
    await page.getByRole('button', { name: 'Paste' }).click()
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('textarea').first()).toHaveValue('paste dialog e2e')
  })

  async function openTextPaste(page: import('@playwright/test').Page, name: string, content: string) {
    await page.getByTestId('file-browser').focus()
    await page.evaluate(({ content }) => {
      const dt = new DataTransfer()
      dt.setData('text/plain', content)
      document.querySelector('[data-testid="file-browser"]')!.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }),
      )
    }, { content })
    await expect(page.getByRole('heading', { name: /Paste Text/i })).toBeVisible()
    await page.getByLabel('Filename').fill(name)
  }

  test('replaces an existing text file through edit and shows a diff', async ({ page }) => {
    const name = `paste-replace-${Date.now()}.txt`
    const target = path.join(mediaDir, UPLOAD_DIR, name)
    fs.writeFileSync(target, 'old text')
    try {
      await page.goto(`/?dir=${UPLOAD_DIR}`)
      await openTextPaste(page, name, 'new text')
      await expect(page.getByTestId('paste-diff')).toContainText('old text')
      const edit = page.waitForResponse((r) => r.url().includes('/api/files/edit') && r.status() === 200)
      await page.getByRole('button', { name: 'Replace', exact: true }).click()
      await edit
      await expect(page.locator('textarea').first()).toHaveValue('new text')
    } finally { fs.rmSync(target, { force: true }) }
  })

  test('saves a conflict with another name', async ({ page }) => {
    const name = `paste-rename-${Date.now()}.txt`
    const renamed = name.replace('.txt', '-copy.txt')
    const target = path.join(mediaDir, UPLOAD_DIR, name)
    const copy = path.join(mediaDir, UPLOAD_DIR, renamed)
    fs.writeFileSync(target, 'original')
    try {
      await page.goto(`/?dir=${UPLOAD_DIR}`)
      await openTextPaste(page, name, 'copy content')
      await page.getByRole('button', { name: 'Save with another name' }).click()
      await page.getByLabel('Filename').fill(renamed)
      await page.getByRole('button', { name: 'Paste', exact: true }).click()
      await expect(page.locator('textarea').first()).toHaveValue('copy content')
      expect(fs.readFileSync(target, 'utf8')).toBe('original')
    } finally { fs.rmSync(target, { force: true }); fs.rmSync(copy, { force: true }) }
  })

  test('cancels an existing-name paste without writing', async ({ page }) => {
    const name = `paste-cancel-${Date.now()}.txt`
    const target = path.join(mediaDir, UPLOAD_DIR, name)
    fs.writeFileSync(target, 'keep me')
    try {
      await page.goto(`/?dir=${UPLOAD_DIR}`)
      await openTextPaste(page, name, 'discard me')
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(page.getByRole('heading', { name: /Paste Text/i })).not.toBeVisible()
      expect(fs.readFileSync(target, 'utf8')).toBe('keep me')
    } finally { fs.rmSync(target, { force: true }) }
  })

  test('reports a version conflict instead of replacing newer content', async ({ page }) => {
    const name = `paste-conflict-${Date.now()}.txt`
    const target = path.join(mediaDir, UPLOAD_DIR, name)
    fs.writeFileSync(target, 'initial')
    try {
      await page.goto(`/?dir=${UPLOAD_DIR}`)
      await openTextPaste(page, name, 'clipboard')
      await new Promise((resolve) => setTimeout(resolve, 20))
      fs.writeFileSync(target, 'newer remote content')
      await page.getByRole('button', { name: 'Replace', exact: true }).click()
      await expect(page.getByText('File changed since the replacement was prepared')).toBeVisible()
      expect(fs.readFileSync(target, 'utf8')).toBe('newer remote content')
    } finally { fs.rmSync(target, { force: true }) }
  })

  test('shows old and new binary metadata and replaces the binary', async ({ page }) => {
    const name = `paste-binary-${Date.now()}.bin`
    const target = path.join(mediaDir, UPLOAD_DIR, name)
    fs.writeFileSync(target, Buffer.from([1, 2, 3]))
    try {
      await page.goto(`/?dir=${UPLOAD_DIR}`)
      await page.getByTestId('file-browser').focus()
      await page.evaluate(({ name }) => {
        const dt = new DataTransfer()
        dt.items.add(new File([new Uint8Array([9, 8, 7, 6])], name, { type: 'application/octet-stream' }))
        document.querySelector('[data-testid="file-browser"]')!.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
      }, { name })
      await expect(page.getByTestId('binary-replacement-info')).toContainText('application/octet-stream')
      await page.getByRole('button', { name: 'Replace', exact: true }).click()
      await expect.poll(() => fs.readFileSync(target).toString('hex')).toBe('09080706')
    } finally { fs.rmSync(target, { force: true }) }
  })
})
