import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

test.describe('mobile media management', () => {
  test('exposes 44px action targets and preserves the chosen view', async ({ page }) => {
    await page.goto('/?dir=Images')
    await page.getByRole('button', { name: 'Display options' }).click()
    await page.getByRole('menuitem', { name: 'Grid view' }).click()
    await expect(page.locator('.file-browser-grid')).toBeVisible()
    const more = page.getByRole('button', { name: 'More actions for photo.jpg', exact: true })
    await expect(more).toHaveCSS('width', '44px')
    await expect(more).toHaveCSS('height', '44px')
    await more.click()
    await expect(page.getByRole('menu')).toBeVisible()
    await expect(page.getByRole('menu').getByText('Favorite', { exact: true })).toBeVisible()
    await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/api/settings/favorite') && resp.status() === 200,
      ),
      page.getByRole('menu').getByText('Favorite', { exact: true }).click(),
    ])
    await expect(page.getByTitle('Remove from favorites')).toBeVisible()
    await more.click()
    await expect(page.getByRole('menu').getByText('Unfavorite', { exact: true })).toBeVisible()
    await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/api/settings/favorite') && resp.status() === 200,
      ),
      page.getByRole('menu').getByText('Unfavorite', { exact: true }).click(),
    ])
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Display options' }).click()
    await Promise.all([
      page.waitForResponse(
        (response) => response.url().includes('/api/settings/viewMode') && response.ok(),
      ),
      page.getByRole('menuitem', { name: 'List view' }).click(),
    ])
    await page.reload()
    await expect(page.locator('table')).toBeVisible()
    const listMore = page.getByRole('button', {
      name: 'More actions for photo.jpg',
      exact: true,
    })
    await expect(listMore).toHaveCSS('width', '44px')
    await expect(listMore).toHaveCSS('height', '44px')
  })

  test('swipes between images', async ({ page }) => {
    await page.goto('/?dir=Images&viewing=Images%2Fphoto.jpg')
    const surface = page.getByTestId('image-gesture-surface')
    const box = (await surface.boundingBox())!
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await surface.dispatchEvent('pointerdown', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: box.x + 300,
      clientY: box.y + 200,
    })
    await surface.dispatchEvent('pointerup', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: box.x + 180,
      clientY: box.y + 200,
    })
    await expect(page.locator('img[alt="photo.png"]')).toBeVisible()
  })

  test('renders PDFs in the controlled mobile viewer', async ({ page }) => {
    await page.goto('/?dir=Documents&viewing=Documents%2Fsample.pdf')
    await expect(page.getByTestId('pdf-canvas')).toBeVisible()
    await expect(page.locator('embed')).toHaveCount(0)
    const controls = page.getByRole('dialog').locator('button')
    for (let i = 0; i < (await controls.count()); i += 1) {
      const box = await controls.nth(i).boundingBox()
      expect(box?.height).toBe(32)
    }
  })
})
