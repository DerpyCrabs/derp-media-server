import { test, expect, type Page } from '@playwright/test'

async function useListView(page: Page) {
  await page.getByRole('button', { name: 'Display options' }).click()
  await page.getByRole('menuitem', { name: 'List view' }).click()
  await expect(page.locator('table')).toBeVisible()
}

test.describe('Image Viewer', () => {
  test('image thumbnails appear in grid view', async ({ page }) => {
    await page.goto('/?dir=Images')
    await page.getByRole('button', { name: 'Display options' }).click()
    await page.getByRole('menuitem', { name: 'Grid view' }).click()
    const card = page
      .locator('[data-testid=file-browser] .file-browser-grid [role=button]')
      .filter({
        hasText: 'photo.jpg',
      })
    const thumb = card.locator('[data-testid=file-browser-image-thumbnail]')
    await expect(thumb).toBeVisible()
    await expect(thumb).toHaveAttribute('src', /\/api\/thumbnail\//)

    const response = await page.request.get('/api/thumbnail/Images/photo.jpg')
    expect(response.headers()['content-type']).toContain('image/jpeg')

    await page.getByRole('button', { name: 'Display options' }).click()
    await page.getByRole('menuitem', { name: 'List view' }).click()
  })

  test('opens image viewer when clicking an image file', async ({ page }) => {
    await page.goto('/?dir=Images')
    await useListView(page)
    await page.locator('table').getByText('photo.jpg').click()
    const image = page.locator('img[alt="photo.jpg"]')
    await expect(image).toBeVisible()
    await expect(image).toHaveAttribute('src', /\/api\/image\/Images\/photo\.jpg\?/)
  })

  test('reflects viewing image in URL', async ({ page }) => {
    await page.goto('/?dir=Images')
    await useListView(page)
    await page.locator('table').getByText('photo.jpg').click()
    await expect(page).toHaveURL(/viewing=Images.*photo\.jpg/)
  })

  test('shows zoom controls', async ({ page }) => {
    await page.goto('/?dir=Images&viewing=Images%2Fphoto.jpg')
    await expect(page.locator('button:has(.lucide-zoom-in)')).toBeVisible()
    await expect(page.locator('button:has(.lucide-zoom-out)')).toBeVisible()
    await expect(page.getByText('Fit')).toBeVisible()
  })

  test('keeps every header action inside a narrow mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await page.goto('/?dir=Images&viewing=Images%2Fphoto.jpg')

    const dialog = page.getByRole('dialog')
    const buttons = dialog.locator('button')
    await expect(buttons).toHaveCount(6)
    for (let index = 0; index < 6; index += 1) {
      const box = await buttons.nth(index).boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(320)
    }
  })

  test('zooms in and out on button click', async ({ page }) => {
    await page.goto('/?dir=Images&viewing=Images%2Fphoto.jpg')
    await expect(page.getByText('Fit')).toBeVisible()

    await page.locator('button:has(.lucide-zoom-in)').click()
    await expect(page.getByText('125%')).toBeVisible()

    await page.locator('button:has(.lucide-zoom-out)').click()
    await expect(page.getByText('Fit').or(page.getByText('100%'))).toBeVisible()
  })

  test('rotates image via rotate button', async ({ page }) => {
    let releaseNextImage!: () => void
    const nextImageGate = new Promise<void>((resolve) => {
      releaseNextImage = resolve
    })
    await page.route('**/api/image/Images/photo.png*', async (route) => {
      await nextImageGate
      await route.continue()
    })
    await page.goto('/?dir=Images&viewing=Images%2Fphoto.jpg')
    const img = page.locator('img[alt="photo.jpg"]')
    await expect(img).toBeVisible()

    const rotateButton = page.locator('button:has(.lucide-rotate-cw)')
    await rotateButton.click()
    expect(await img.evaluate((el) => el.style.transform)).toContain('rotate(90deg)')
    const surfaceBox = (await page.getByTestId('image-gesture-surface').boundingBox())!
    const imageBox = (await img.boundingBox())!
    expect(imageBox.x).toBeGreaterThanOrEqual(surfaceBox.x)
    expect(imageBox.y).toBeGreaterThanOrEqual(surfaceBox.y)
    expect(imageBox.x + imageBox.width).toBeLessThanOrEqual(surfaceBox.x + surfaceBox.width)
    expect(imageBox.y + imageBox.height).toBeLessThanOrEqual(surfaceBox.y + surfaceBox.height)

    await rotateButton.click({ clickCount: 3 })
    expect(await img.evaluate((el) => el.style.transform)).toContain('rotate(0deg)')

    await rotateButton.click()
    await page.keyboard.press('ArrowRight')
    const nextImage = page.locator('img[alt="photo.png"]')
    expect(await nextImage.evaluate((el) => el.style.transform)).toContain('rotate(90deg)')

    releaseNextImage()
    await expect(nextImage).toBeVisible()
    await expect(nextImage).toHaveAttribute('src', /\/api\/image\/Images\/photo\.png/)
    expect(await nextImage.evaluate((el) => el.style.transform)).toContain('rotate(0deg)')
  })

  test('fit-to-screen button resets zoom and rotation', async ({ page }) => {
    await page.goto('/?dir=Images&viewing=Images%2Fphoto.jpg')

    await page.locator('button:has(.lucide-zoom-in)').click()
    await page.locator('button:has(.lucide-rotate-cw)').click()

    await page.locator('button[title="Fit to screen"]').click()
    await expect(page.getByText('Fit')).toBeVisible()
    const img = page.locator('img[alt="photo.jpg"]')
    const transform = await img.evaluate((el) => el.style.transform)
    expect(transform).toContain('rotate(0deg)')
  })

  test('navigates to next image with ArrowRight key', async ({ page }) => {
    await page.goto('/?dir=Images')
    await useListView(page)
    await page.locator('table').getByText('photo.jpg').click()
    await expect(page.locator('img[alt="photo.jpg"]')).toBeVisible()
    await expect(page.getByText('1 of 2')).toBeVisible()

    await page.evaluate(() =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
    )
    await expect(page.locator('img[alt="photo.png"]')).toBeVisible()
    await expect(page.getByText('2 of 2')).toBeVisible()
  })

  test('navigates to previous image with ArrowLeft key', async ({ page }) => {
    await page.goto('/?dir=Images')
    await useListView(page)
    await page.locator('table').getByText('photo.png').click()
    await expect(page.locator('img[alt="photo.png"]')).toBeVisible()

    await page.evaluate(() =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })),
    )
    await expect(page.locator('img[alt="photo.jpg"]')).toBeVisible()
  })

  test('does not swipe images when dragging with a mouse', async ({ page }) => {
    await page.goto('/?dir=Images&viewing=Images%2Fphoto.jpg')
    const surface = page.getByTestId('image-gesture-surface')
    const box = (await surface.boundingBox())!
    await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 20, box.y + box.height / 2)
    await page.mouse.up()
    await expect(page.locator('img[alt="photo.jpg"]')).toBeVisible()
    await expect(page).toHaveURL(/viewing=Images%2Fphoto\.jpg/)
  })

  test('navigates images by clicking desktop edge zones', async ({ page }) => {
    await page.goto('/?dir=Images&viewing=Images%2Fphoto.jpg')
    await page.getByTestId('image-next-zone').click()
    await expect(page.locator('img[alt="photo.png"]')).toBeVisible()
    await page.getByTestId('image-previous-zone').click()
    await expect(page.locator('img[alt="photo.jpg"]')).toBeVisible()
  })

  test('navigates images with desktop scroll wheel', async ({ page }) => {
    await page.goto('/?dir=Images&viewing=Images%2Fphoto.jpg')
    await expect(page.getByText('1 of 2')).toBeVisible()
    await page.getByTestId('image-gesture-surface').hover()
    await page.mouse.wheel(0, 100)
    await expect(page.locator('img[alt="photo.png"]')).toBeVisible()

    await page.waitForTimeout(300)
    await page.mouse.wheel(0, -100)
    await expect(page.locator('img[alt="photo.jpg"]')).toBeVisible()
  })

  test('shows image counter', async ({ page }) => {
    await page.goto('/?dir=Images&viewing=Images%2Fphoto.jpg')
    await expect(page.getByText('1 of 2')).toBeVisible()
  })

  test('closing viewer returns to file list', async ({ page }) => {
    await page.goto('/?dir=Images&viewing=Images%2Fphoto.jpg')
    await expect(page.locator('img[alt="photo.jpg"]')).toBeVisible()

    await page.locator('button:has(.lucide-x)').click()
    await expect(page.locator('img[alt="photo.jpg"]')).not.toBeVisible()
    await useListView(page)
    await expect(page.locator('table').getByText('photo.jpg')).toBeVisible()
    await expect(page).not.toHaveURL(/viewing=/)
  })
})
