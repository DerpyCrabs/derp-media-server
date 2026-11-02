import { test, expect, type Page } from '@playwright/test'

async function switchToListView(page: Page) {
  await page.getByRole('button', { name: 'Display options' }).click()
  await page.getByRole('menuitemradio', { name: 'List view' }).click()
  await expect(page.locator('table')).toBeVisible()
}

test.describe('Image Viewer', () => {
  test.describe('ordinary HTTP', () => {
    test('shuffles without a secure browser context', async ({ page, baseURL }) => {
      const url = new URL('/?dir=Images&viewing=Images%2Fphoto.jpg', baseURL)
      url.hostname = 'media-server.test'
      await page.route(`${url.origin}/**`, async (route) => {
        const requestUrl = new URL(route.request().url())
        const target = new URL(requestUrl.pathname + requestUrl.search, baseURL)
        await route.continue({ url: target.href })
      })
      await page.goto(url.href, { waitUntil: 'domcontentloaded' })
      expect(await page.evaluate(() => window.isSecureContext)).toBe(false)
      expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined')
      const shuffle = page.getByRole('button', { name: 'Shuffle images' })
      await shuffle.click()
      await expect(page.getByRole('dialog').getByText(/\d+ of \d+/)).toHaveText('1 of 2')
      const seed = new URL(page.url()).searchParams.get('imageSeed')
      expect(seed).toBeTruthy()
      await shuffle.click()
      expect(new URL(page.url()).searchParams.get('imageSeed')).not.toBe(seed)
      await page.reload()
      await expect(page.getByRole('dialog').getByText(/\d+ of \d+/)).toHaveText('1 of 2')

      const workspace = new URL('/workspace?ws=http-' + Date.now(), url)
      await page.goto(workspace.href, { waitUntil: 'domcontentloaded', timeout: 5000 })
      const content = page.locator('.workspace-window-content').first()
      await content.getByText('Images', { exact: true }).click()
      await content.locator('table').getByText('photo.jpg').click()
      await page.getByRole('button', { name: 'Shuffle images' }).click()
      await expect(page.getByText('1 of 2', { exact: true })).toBeVisible()
    })
  })

  test('shuffle survives reload and copied URLs, and resets when reopening', async ({
    page,
    context,
  }) => {
    await page.goto('/?dir=Images&viewing=Images%2Fphoto.jpg')
    const shuffle = page.getByRole('button', { name: 'Shuffle images' })
    await shuffle.click()
    await expect(page.getByRole('dialog').getByText(/\d+ of \d+/)).toHaveText('1 of 2')
    const url = page.url()
    const firstPath = new URL(url).searchParams.get('viewing')!
    const firstName = firstPath.split('/').pop()!
    const secondName = firstName === 'photo.jpg' ? 'photo.png' : 'photo.jpg'
    expect(new URL(url).searchParams.get('imageSeed')).toBeTruthy()
    const counter = await page
      .getByRole('dialog')
      .getByText(/\d+ of \d+/)
      .textContent()
    await page.reload()
    await expect(page.getByRole('dialog').getByText(/\d+ of \d+/)).toHaveText(counter!)
    const other = await context.newPage()
    try {
      await other.goto(url)
      await expect(other.getByRole('dialog').getByText(/\d+ of \d+/)).toHaveText(counter!)
      await other.keyboard.press('ArrowRight')
      await expect(other.getByRole('dialog').getByText(/\d+ of \d+/)).toHaveText('2 of 2')
      await other.getByRole('button', { name: 'Shuffle images' }).click()
      await expect(other.getByRole('dialog').getByText(/\d+ of \d+/)).toHaveText('1 of 2')
      const nextSeed = new URL(other.url()).searchParams.get('imageSeed')
      expect(nextSeed).toBeTruthy()
      expect(nextSeed).not.toBe(new URL(url).searchParams.get('imageSeed'))
      expect(new URL(page.url()).searchParams.get('imageSeed')).toBe(
        new URL(url).searchParams.get('imageSeed'),
      )
    } finally {
      await other.close()
    }
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('dialog').getByText(/\d+ of \d+/)).toHaveText('2 of 2')
    await expect(
      page.getByRole('dialog').getByRole('img', { name: secondName, exact: true }),
    ).toBeVisible()
    expect(new URL(page.url()).searchParams.get('imageSeed')).toBe(
      new URL(url).searchParams.get('imageSeed'),
    )
    await page.keyboard.press('ArrowLeft')
    await expect(
      page.getByRole('dialog').getByRole('img', { name: firstName, exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    expect(new URL(page.url()).searchParams.has('imageSeed')).toBe(false)
    await switchToListView(page)
    await page.locator('table').getByText('photo.jpg').click()
    await expect(page.getByRole('button', { name: 'Image actions' })).toBeVisible()
    expect(new URL(page.url()).searchParams.has('imageSeed')).toBe(false)
  })

  test('image thumbnails appear in grid view', async ({ page }) => {
    await page.goto('/?dir=Images')
    await page.getByRole('button', { name: 'Display options' }).click()
    await page.getByRole('menuitemradio', { name: 'Grid view' }).click()
    const card = page
      .locator('[data-testid=file-browser] .file-browser-grid [role=button]')
      .filter({ hasText: 'photo.jpg' })
    const thumb = card.locator('[data-testid=file-browser-image-thumbnail]')
    await expect(thumb).toBeVisible()
    await expect(thumb).toHaveAttribute('src', /\/api\/thumbnail\//)

    const response = await page.request.get('/api/thumbnail/Images/photo.jpg')
    expect(response.headers()['content-type']).toContain('image/jpeg')

    await page.getByRole('button', { name: 'Display options' }).click()
    await page.getByRole('menuitemradio', { name: 'List view' }).click()
  })

  test('opens image viewer when clicking an image file', async ({ page }) => {
    await page.goto('/?dir=Images')
    await switchToListView(page)
    await page.locator('table').getByText('photo.jpg').click()
    const image = page.locator('img[alt="photo.jpg"]')
    await expect(image).toBeVisible()
    await expect(image).toHaveAttribute('src', /\/api\/image\/Images\/photo\.jpg\?/)
  })

  test('reflects viewing image in URL', async ({ page }) => {
    await page.goto('/?dir=Images')
    await switchToListView(page)
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
    await expect(buttons).toHaveCount(8)
    for (let index = 0; index < (await buttons.count()); index += 1) {
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

  test('keeps zoom and rotation chosen while image settings and pixels are loading', async ({
    page,
  }) => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/api/image-config', async (route) => {
      await pending
      await route.continue()
    })
    await page.route('**/api/image/**', async (route) => {
      await pending
      await route.continue()
    })
    try {
      await page.goto('/?dir=Images&viewing=Images%2Fphoto.jpg', { waitUntil: 'domcontentloaded' })
      await expect(page.getByText('Fit', { exact: true })).toBeVisible({ timeout: 2000 })
      await page.locator('button:has(.lucide-zoom-in)').click()
      await page.getByRole('button', { name: 'Rotate clockwise' }).click()
      await expect(page.getByText('125%', { exact: true })).toBeVisible()
      release()
      const image = page.locator('img[alt="photo.jpg"]')
      await expect(image).toBeVisible()
      await expect(image).toHaveAttribute('style', /rotate\(90deg\)/)
      await expect(page.getByText('125%', { exact: true })).toBeVisible()
    } finally {
      release()
      await page.unrouteAll({ behavior: 'wait' })
    }
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

    const rotateButton = page.getByRole('button', { name: 'Rotate clockwise' })
    await rotateButton.click()
    expect(await img.evaluate((el) => el.style.transform)).toContain('rotate(90deg)')
    const surfaceBox = (await page.getByTestId('image-gesture-surface').boundingBox())!
    const imageBox = (await img.boundingBox())!
    expect(imageBox.x).toBeGreaterThanOrEqual(surfaceBox.x)
    expect(imageBox.y).toBeGreaterThanOrEqual(surfaceBox.y)
    expect(imageBox.x + imageBox.width).toBeLessThanOrEqual(surfaceBox.x + surfaceBox.width)
    expect(imageBox.y + imageBox.height).toBeLessThanOrEqual(surfaceBox.y + surfaceBox.height)

    for (let step = 0; step < 3; step++) {
      await rotateButton.click()
    }
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
    await page.getByRole('button', { name: 'Rotate clockwise' }).click()

    await page.locator('button[title="Fit to screen"]').click()
    await expect(page.getByText('Fit')).toBeVisible()
    const img = page.locator('img[alt="photo.jpg"]')
    const transform = await img.evaluate((el) => el.style.transform)
    expect(transform).toContain('rotate(0deg)')
  })

  test('navigates to next image with ArrowRight key', async ({ page }) => {
    await page.goto('/?dir=Images')
    await switchToListView(page)
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
    await switchToListView(page)
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

  test('actual-size images can be panned to every edge without changing files', async ({
    page,
  }) => {
    await page.route('**/api/media/Images/photo.jpg*', (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1800"><rect width="2400" height="1800" fill="orange"/></svg>',
      }),
    )
    await page.goto('/?dir=Images&viewing=Images%2Fphoto.jpg')
    await expect(page.getByRole('img', { name: 'photo.jpg', exact: true })).toBeVisible()
    await page.keyboard.press('1')
    const surface = page.getByTestId('image-gesture-surface')
    const image = surface.getByRole('img')
    await expect(page.getByText('100%', { exact: true })).toBeVisible()
    await expect.poll(() => image.evaluate((el) => el.getBoundingClientRect().width)).toBe(2400)
    await expect(page.getByTestId('image-next-zone')).toHaveCount(0)
    const box = (await surface.boundingBox())!
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3, { steps: 5 })
    await page.mouse.up()
    expect(await surface.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100)
    expect(await surface.evaluate((el) => el.scrollTop)).toBeGreaterThan(100)
    await surface.evaluate((el) => {
      el.scrollLeft = el.scrollWidth
      el.scrollTop = el.scrollHeight
    })
    const imageBox = (await image.boundingBox())!
    expect(imageBox.x + imageBox.width).toBeLessThanOrEqual(box.x + box.width)
    expect(imageBox.y + imageBox.height).toBeLessThanOrEqual(box.y + box.height)
    await surface.hover()
    await page.mouse.wheel(0, -100)
    expect(new URL(page.url()).searchParams.get('viewing')).toBe('Images/photo.jpg')
    await page.keyboard.press('0')
    await expect(page.getByText('Fit', { exact: true })).toBeVisible()
    await expect(page.getByTestId('image-next-zone')).toBeVisible()
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
    await switchToListView(page)
    await expect(page.locator('table').getByText('photo.jpg')).toBeVisible()
    await expect(page).not.toHaveURL(/viewing=/)
  })
})

for (const width of [1280, 390]) {
  test(`embedded image navigation stays invisible and fills the image surface at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.addInitScript(() =>
      Object.assign(window, {
        derpDesktop: {
          ready: async () => {},
          onOpen: () => () => {},
          onBeforeClose: () => () => {},
          close: () => {},
        },
      }),
    )
    await page.goto('/desktop?mode=viewer&dir=Images&viewing=Images%2Fphoto.jpg')
    await expect(page.getByRole('img', { name: 'photo.jpg', exact: true })).toBeVisible()
    const surface = page.getByTestId('workspace-image-surface')
    const bounds = (await surface.boundingBox())!
    for (const direction of ['previous', 'next']) {
      const zone = page.getByTestId(`image-${direction}-zone`)
      const box = (await zone.boundingBox())!
      expect(box.y).toBeCloseTo(bounds.y, 0)
      expect(box.height).toBeCloseTo(bounds.height, 0)
      await zone.hover({ position: { x: box.width / 2, y: box.height - 12 } })
      await expect(zone).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await expect(zone).toHaveCSS('border-top-width', '0px')
    }
    await page.getByTestId('image-next-zone').click({ position: { x: 12, y: bounds.height - 12 } })
    await expect(page.getByRole('img', { name: 'photo.png', exact: true })).toBeVisible()
    await page
      .getByTestId('image-previous-zone')
      .click({ position: { x: 12, y: bounds.height - 12 } })
    await expect(page.getByRole('img', { name: 'photo.jpg', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Shuffle images', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Rotate clockwise', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}
