import { test, expect, type Page } from '@playwright/test'

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
  await expect(page.getByRole('region', { name: 'Image editor' }).getByRole('status')).toHaveText(
    '800 × 600 px',
  )
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
  await page.mouse.move(stage!.x + stage!.width * 0.125, stage!.y + stage!.height / 6)
  await page.mouse.down()
  await page.mouse.move(stage!.x + stage!.width * 0.5, stage!.y + stage!.height * 0.5, { steps: 5 })
  await page.mouse.up()
  await page.getByRole('spinbutton', { name: 'Crop left' }).fill('100')
  await page.getByRole('spinbutton', { name: 'Crop top' }).fill('100')
  await page.getByRole('spinbutton', { name: 'Crop width' }).fill('300')
  await page.getByRole('spinbutton', { name: 'Crop height' }).fill('200')
  await editor.getByRole('button', { name: 'Apply crop' }).click()
  await expect(editor.getByRole('status')).toHaveText('300 × 200 px')
  await editor.getByRole('button', { name: 'Rotate image clockwise' }).click()
  await expect(editor.getByRole('status')).toHaveText('200 × 300 px')
  await editor.getByRole('button', { name: 'Resize image', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Image width' }).fill('100')
  await expect(page.getByRole('spinbutton', { name: 'Image height' })).toHaveValue('150')
  await editor.getByRole('button', { name: 'Apply size' }).click()
  await expect(editor.getByRole('status')).toHaveText('100 × 150 px')
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
  await editor.getByRole('button', { name: 'Rotate image clockwise' }).click()
  await page.keyboard.press('Control+z')
  await expect(editor.getByRole('status')).toHaveText('800 × 600 px')
  await page.keyboard.press('Control+Shift+z')
  await expect(editor.getByRole('status')).toHaveText('600 × 800 px')
  await editor.getByRole('button', { name: 'Save copy', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Save image copy' })
  await dialog.getByRole('textbox', { name: 'File name' }).fill(path.split('/').at(-1)!)
  await expect(dialog.getByRole('button', { name: 'Save copy', exact: true })).toBeDisabled()
  await expect(
    dialog.getByText('A file with this name already exists. Choose another name.'),
  ).toBeVisible()
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
  await editor.getByRole('button', { name: 'Select all', exact: true }).click()
  await expect(editor.getByRole('spinbutton', { name: 'Crop width' })).toBeVisible()
  await editor.getByRole('button', { name: 'Apply crop' }).click()
  await page.keyboard.press('Control+s')
  const dialog = page.getByRole('dialog', { name: 'Save image copy' })
  await expect(dialog.getByRole('button', { name: 'Save copy', exact: true })).toHaveCount(0)
  await dialog.getByRole('combobox', { name: 'Export format' }).selectOption('image/jpeg')
  await expect(dialog.getByRole('textbox', { name: 'File name' })).toHaveValue('photo-edited.jpg')
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download copy', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('photo-edited.jpg')
  expect(await download.failure()).toBeNull()
  await editor.getByRole('button', { name: 'Close image editor' }).click()
  await expect(editor).not.toBeVisible()
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
  await page.getByRole('button', { name: 'Rotate image clockwise' }).click()
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
  await expect(
    page.getByRole('toolbar', { name: 'Image editing tools' }).getByRole('status'),
  ).toHaveText('600 × 800 px')
})
