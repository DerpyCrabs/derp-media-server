import { waitForDocumentDraft } from './document-draft-helpers'
import { gotoWorkspace, getWindowGroups } from './workspace-layout-helpers'
import { test, expect, type Page } from '@playwright/test'

async function expectDimensions(page: Page, width: number, height: number) {
  await expect
    .poll(() =>
      page
        .getByRole('img', { name: 'Edited image preview' })
        .evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight]),
    )
    .toEqual([width, height])
}
async function imageAction(page: Page, name: string) {
  await page.getByRole('button', { name: 'Image edit actions', exact: true }).click()
  await page.getByRole('menuitem', { name, exact: true }).click()
}
async function createImage(page: Page) {
  await page.goto('/')
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 800
    canvas.height = 600
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#285b90'
    ctx.fillRect(0, 0, 800, 600)
    ctx.fillStyle = '#f07030'
    ctx.fillRect(100, 100, 300, 200)
    return canvas.toDataURL('image/png').split(',')[1]!
  })
  const name = `image-edit-${Date.now()}.png`
  const response = await page.request.post('/api/files/upload?create_only=true', {
    multipart: {
      targetDir: 'Notes',
      file: { name, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') },
    },
  })
  expect(response.ok()).toBeTruthy()
  const path = `Notes/${name}`
  await page.goto(`/?dir=Notes&viewing=${encodeURIComponent(path)}`)
  await page.getByRole('button', { name: 'Edit image', exact: true }).click()
  await expectDimensions(page, 800, 600)
  return { path, original: png }
}

test('crops, rotates, resizes and saves a pixel-correct copy without changing the original', async ({
  page,
}) => {
  const { path, original } = await createImage(page)
  const editor = page.getByRole('region', { name: 'Image editor' })
  await editor.getByRole('button', { name: 'Crop image', exact: true }).click()
  const stage = await page.getByTestId('image-edit-stage').boundingBox()
  expect(stage).toBeTruthy()
  for (const [label, dx, dy] of [
    ['bottom right', -400, -300],
    ['top left', 100, 100],
  ] as const) {
    const handle = await editor
      .getByRole('button', { name: `Resize crop ${label}`, exact: true })
      .boundingBox()
    const x = handle!.x + handle!.width / 2,
      y = handle!.y + handle!.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + (dx * stage!.width) / 800, y + (dy * stage!.height) / 600, {
      steps: 5,
    })
    await page.mouse.up()
  }
  await expect(editor.getByRole('spinbutton')).toHaveCount(0)
  await editor.getByRole('button', { name: 'Apply crop' }).click()
  await expectDimensions(page, 300, 200)
  await imageAction(page, 'Rotate clockwise')
  await expectDimensions(page, 200, 300)
  await editor.getByRole('button', { name: 'Resize image', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Image width' }).fill('100')
  await expect(page.getByRole('spinbutton', { name: 'Image height' })).toHaveValue('150')
  await editor.getByRole('button', { name: 'Apply size' }).click()
  await expectDimensions(page, 100, 150)
  await editor.getByRole('button', { name: 'Save copy', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Save image copy' })
  const name = `edited-result-${Date.now()}.png`
  await dialog.getByRole('textbox', { name: 'File name' }).fill(name)
  await dialog.getByRole('button', { name: 'Save copy', exact: true }).click()
  await expect(editor).not.toBeVisible()
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(`Notes/${name}`)))
  expect(
    (
      await (await page.request.get(`/api/files/download?path=${encodeURIComponent(path)}`)).body()
    ).toString('base64'),
  ).toBe(original)
  const pixels = await page.evaluate(async (path) => {
    const bitmap = await createImageBitmap(
      await (await fetch(`/api/files/download?path=${encodeURIComponent(path)}`)).blob(),
    )
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    const result = {
      width: bitmap.width,
      height: bitmap.height,
      pixel: [...ctx.getImageData(50, 75, 1, 1).data],
    }
    bitmap.close()
    return result
  }, `Notes/${name}`)
  expect(pixels).toEqual({ width: 100, height: 150, pixel: [240, 112, 48, 255] })
})

test('undo, redo and discard protect the source; save refuses existing names', async ({ page }) => {
  const { path } = await createImage(page)
  const editor = page.getByRole('region', { name: 'Image editor' })
  await imageAction(page, 'Rotate clockwise')
  await page.keyboard.press('Control+z')
  await expectDimensions(page, 800, 600)
  await page.keyboard.press('Control+Shift+z')
  await expectDimensions(page, 600, 800)
  await editor.getByRole('button', { name: 'Save copy', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Save image copy' })
  await dialog.getByRole('textbox', { name: 'File name' }).fill(path.split('/').at(-1)!)
  await expect(dialog.getByRole('button', { name: 'Save copy', exact: true })).toBeDisabled()
  await expect(dialog.getByText('A file with this name already exists.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await editor.getByRole('button', { name: 'Close image editor' }).click()
  await page.getByRole('button', { name: 'Discard edits', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Edit image', exact: true })).toBeVisible()
})

test('keyboard crop and JPEG download work with no writable folders', async ({ page }) => {
  await page.route('**/api/config', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...(await response.json()), editableFolders: [] } })
  })
  await page.goto('/?dir=Images&viewing=Images%2Fphoto.jpg')
  await page.getByRole('button', { name: 'Edit image', exact: true }).click()
  const editor = page.getByRole('region', { name: 'Image editor' })
  await editor.getByRole('button', { name: 'Crop image', exact: true }).click()
  const corner = editor.getByRole('button', { name: 'Resize crop bottom right', exact: true })
  await corner.focus()
  await corner.press('Shift+ArrowLeft')
  await corner.press('Shift+ArrowUp')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Control+s')
  const dialog = page.getByRole('dialog', { name: 'Save image copy' })
  await expect(dialog.getByRole('button', { name: 'Save copy', exact: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Export format' }).click()
  await page.getByRole('option', { name: 'JPEG', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: 'File name' })).toHaveValue('photo-edited.jpg')
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download copy', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('photo-edited.jpg')
  expect(await download.failure()).toBeNull()
  await editor.getByRole('button', { name: 'Close image editor' }).click()
  await expect(editor).not.toBeVisible()
  await page.getByRole('button', { name: 'Edit image', exact: true }).click()
  await page.getByRole('button', { name: 'Image edit actions' }).click()
  await expect(
    page.getByRole('menuitem', { name: 'Restore unsaved edits', exact: true }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Discard edits', exact: true })).toHaveCount(0)
})

test('image viewing and edit controls fit a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  const { path } = await createImage(page)
  const editor = page.getByRole('region', { name: 'Image editor' })
  const preview = await editor.getByRole('img', { name: 'Edited image preview' }).boundingBox()
  expect(preview).toBeTruthy()
  expect(preview!.width / preview!.height).toBeCloseTo(4 / 3, 1)
  await editor.getByRole('button', { name: 'Close image editor' }).click()
  const bounds = await page
    .getByRole('dialog')
    .getByRole('button')
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const box = button.getBoundingClientRect()
        return { left: box.left, right: box.right }
      }),
    )
  expect(bounds.every((box) => box.left >= 0 && box.right <= 320)).toBe(true)
  expect(new URL(page.url()).searchParams.get('viewing')).toBe(path)
})

test('a save collision that happens after opening the dialog preserves both images', async ({
  page,
}) => {
  await createImage(page)
  await imageAction(page, 'Rotate clockwise')
  await page.getByRole('button', { name: 'Save copy', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Save image copy' })
  const name = `collision-${Date.now()}.png`
  await dialog.getByRole('textbox', { name: 'File name' }).fill(name)
  await page.route('**/api/files/upload?create_only=true', async (route) => {
    await page.request.post('/api/files/upload?create_only=true', {
      multipart: {
        targetDir: 'Notes',
        file: { name, mimeType: 'text/plain', buffer: Buffer.from('existing file') },
      },
    })
    await route.continue()
  })
  await dialog.getByRole('button', { name: 'Save copy', exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  expect(
    await (
      await page.request.get(`/api/files/download?path=${encodeURIComponent(`Notes/${name}`)}`)
    ).text(),
  ).toBe('existing file')
  await expectDimensions(page, 600, 800)
})

test('image drafts survive reload and restore the saved source after the file is replaced', async ({
  page,
}) => {
  const { path } = await createImage(page)
  const editor = page.getByRole('region', { name: 'Image editor' })
  await imageAction(page, 'Rotate clockwise')
  await waitForDocumentDraft(page, path)
  const replacement = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 24
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#00ff00'
    ctx.fillRect(0, 0, 32, 24)
    return canvas.toDataURL('image/png').split(',')[1]!
  })
  const replace = await page.request.post('/api/files/upload', {
    multipart: {
      targetDir: 'Notes',
      file: {
        name: path.split('/').at(-1)!,
        mimeType: 'image/png',
        buffer: Buffer.from(replacement, 'base64'),
      },
    },
  })
  expect(replace.ok(), await replace.text()).toBeTruthy()
  page.once('dialog', (dialog) => dialog.accept())
  await page.reload()
  await page.getByRole('button', { name: 'Edit image', exact: true }).click()
  await expectDimensions(page, 32, 24)
  await imageAction(page, 'Restore unsaved edits')
  await expectDimensions(page, 600, 800)
  const pixel = await editor
    .getByRole('img', { name: 'Edited image preview' })
    .evaluate((image) => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 32
      const context = canvas.getContext('2d')!
      context.drawImage(image as HTMLImageElement, 0, 0)
      return [...context.getImageData(10, 10, 1, 1).data]
    })
  expect(pixel).toEqual([40, 91, 144, 255])
  await editor.getByRole('button', { name: 'Save copy', exact: true }).click()
  const save = page.getByRole('dialog', { name: 'Save image copy' })
  await save.getByRole('textbox', { name: 'File name' }).fill(`recovered-${Date.now()}.png`)
  await save.getByRole('button', { name: 'Save copy', exact: true }).click()
  await expect(editor).not.toBeVisible()
  const original = await page.request.get(`/api/files/download?path=${encodeURIComponent(path)}`)
  expect((await original.body()).toString('base64')).toBe(replacement)
  await page.goto(`/?dir=Notes&viewing=${encodeURIComponent(path)}`)
  await page.getByRole('button', { name: 'Edit image', exact: true }).click()
  await expect(editor.getByRole('menuitem', { name: 'Restore unsaved edits' })).toHaveCount(0)
})

test('explicitly discarded image edits do not return as a recovered draft', async ({ page }) => {
  const { path } = await createImage(page)
  const editor = page.getByRole('region', { name: 'Image editor' })
  await imageAction(page, 'Rotate clockwise')
  await waitForDocumentDraft(page, path)
  await editor.getByRole('button', { name: 'Close image editor' }).click()
  await page.getByRole('button', { name: 'Discard edits', exact: true }).click()
  await page.getByRole('button', { name: 'Edit image', exact: true }).click()
  await expectDimensions(page, 800, 600)
  await expect(editor.getByRole('menuitem', { name: 'Restore unsaved edits' })).toHaveCount(0)
})

test('closing a workspace image window immediately flushes its pending edit for recovery', async ({
  page,
}) => {
  const { path } = await createImage(page)
  await page.getByRole('button', { name: 'Close image editor' }).click()
  await gotoWorkspace(page)
  const browser = getWindowGroups(page).first().locator('.workspace-window-content')
  await browser.getByText('Notes', { exact: true }).click()
  const name = path.split('/').at(-1)!
  await browser.locator('table').getByText(name, { exact: true }).click()
  await expect(getWindowGroups(page)).toHaveCount(2)
  await page.getByRole('button', { name: 'Edit image', exact: true }).click()
  await imageAction(page, 'Rotate clockwise')
  await getWindowGroups(page)
    .nth(1)
    .locator('.workspace-window-buttons button:has(.lucide-x)')
    .click()
  await expect(getWindowGroups(page)).toHaveCount(1)
  await browser.locator('table').getByText(name, { exact: true }).click()
  await page.getByRole('button', { name: 'Edit image', exact: true }).click()
  await imageAction(page, 'Restore unsaved edits')
  await expectDimensions(page, 600, 800)
})

test('unavailable browser storage is visible and does not prevent saving an image copy', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(indexedDB, 'open', {
      value: () => {
        throw new DOMException('Storage blocked', 'SecurityError')
      },
    })
  })
  await createImage(page)
  const editor = page.getByRole('region', { name: 'Image editor' })
  await imageAction(page, 'Rotate clockwise')
  await expect(editor.getByRole('alert')).toContainText('Save a copy before closing')
  await editor.getByRole('button', { name: 'Save copy', exact: true }).click()
  const save = page.getByRole('dialog', { name: 'Save image copy' })
  await save
    .getByRole('textbox', { name: 'File name' })
    .fill(`storage-unavailable-${Date.now()}.png`)
  await save.getByRole('button', { name: 'Save copy', exact: true }).click()
  await expect(editor).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit image', exact: true })).toBeVisible()
})

test('failed image editor loading leaves a way back to the image', async ({ page }) => {
  await page.route('**/assets/ImageEditor-*.js', (route) => route.abort('failed'))
  await page.goto('/?dir=Images&viewing=Images%2Fphoto.jpg')
  await page.getByRole('button', { name: 'Edit image', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Unable to load the image editor')
  await page.getByRole('button', { name: 'Back to image', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Edit image', exact: true })).toBeVisible()
})

test('desktop image copies save to a folder without offering downloads', async ({ page }) => {
  await createImage(page)
  const editor = page.getByRole('region', { name: 'Image editor' })
  await imageAction(page, 'Rotate clockwise')
  await page.evaluate(() =>
    Object.assign(window, {
      derpDesktop: {
        downloadBlob: async () => {
          throw new Error('Unexpected download')
        },
      },
    }),
  )
  await editor.getByRole('button', { name: 'Save copy', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Save image copy', exact: true })
  await expect(dialog.getByRole('button', { name: 'Download copy', exact: true })).toHaveCount(0)
  const name = `desktop-image-${Date.now()}.png`
  await dialog.getByRole('textbox', { name: 'File name', exact: true }).fill(name)
  await dialog.getByRole('button', { name: 'Save copy', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(editor).not.toBeVisible()
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(`Notes/${name}`)))
  const saved = await page.request.get(
    `/api/files/download?path=${encodeURIComponent(`Notes/${name}`)}`,
  )
  expect(saved.ok()).toBe(true)
  expect((await saved.body()).length).toBeGreaterThan(100)
})

test('phone crop starts with handles, keeps square proportions while dragging and cancels without edits', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await createImage(page)
  const editor = page.getByRole('region', { name: 'Image editor' })
  await editor.getByRole('button', { name: 'Crop image', exact: true }).click()
  await expect(editor.getByRole('spinbutton')).toHaveCount(0)
  await expect(editor.getByRole('button', { name: 'Save copy', exact: true })).toHaveCount(0)
  await editor.getByRole('button', { name: 'Crop proportions', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Square', exact: true }).click()
  const handle = editor.getByRole('button', { name: 'Resize crop bottom right', exact: true })
  const box = (await handle.boundingBox())!
  expect(box.width).toBeGreaterThanOrEqual(44)
  expect(box.height).toBeGreaterThanOrEqual(44)
  const selection = editor.getByRole('group', { name: 'Move crop selection' })
  const before = (await selection.boundingBox())!
  const touch = await page.context().newCDPSession(page)
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  for (let step = 1; step <= 5; step++) {
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x - step * 10, y: y - step * 4 }],
    })
  }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await touch.detach()
  const after = (await selection.boundingBox())!
  expect(after.width).toBeLessThan(before.width)
  expect(Math.abs(after.width - after.height)).toBeLessThan(1)
  await selection.click()
  await expect(selection).toBeFocused()
  const movedFrom = (await selection.boundingBox())!
  await page.keyboard.press('Shift+ArrowRight')
  expect((await selection.boundingBox())!.x).toBeGreaterThan(movedFrom.x)
  await page.keyboard.press('Escape')
  await expectDimensions(page, 800, 600)
  await expect(editor.getByRole('button', { name: 'Crop image', exact: true })).toBeVisible()
  await editor.getByRole('button', { name: 'Crop image', exact: true }).click()
  await editor.getByRole('button', { name: 'Apply crop', exact: true }).click()
  await expectDimensions(page, 600, 600)
  await imageAction(page, 'Undo')
  await expectDimensions(page, 800, 600)
})

for (const width of [1280, 390]) {
  test(`resize uses one toolbar and cancels without changing pixels at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 })
    await createImage(page)
    const editor = page.getByRole('region', { name: 'Image editor' })
    const toolbar = editor.getByRole('toolbar', { name: 'Image editing tools' })
    const before = await toolbar.boundingBox()
    await editor.getByRole('button', { name: 'Resize image', exact: true }).click()
    await toolbar.getByRole('spinbutton', { name: 'Image width' }).fill('400')
    await expect(toolbar.getByRole('spinbutton', { name: 'Image height' })).toHaveValue('300')
    const after = await toolbar.boundingBox()
    expect(after!.height).toBe(before!.height)
    for (const button of await toolbar.getByRole('button').all()) {
      const box = await button.boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    }
    await page.keyboard.press('Escape')
    await expectDimensions(page, 800, 600)
    await expect(editor.getByRole('button', { name: 'Resize image', exact: true })).toBeVisible()
    await editor.getByRole('button', { name: 'Resize image', exact: true }).click()
    await toolbar.getByRole('spinbutton', { name: 'Image width' }).fill('400')
    await page.keyboard.press('Enter')
    await expectDimensions(page, 400, 300)
  })
}
