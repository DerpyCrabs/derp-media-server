import { test, expect, type Route } from '@playwright/test'

test.describe('PDF Viewer', () => {
  test('loads reader code and PDF styles only when a PDF is opened', async ({ page }) => {
    test.skip(process.env.E2E_DEV === '1', 'Checks production code splitting')
    const assets: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/assets/')) assets.push(request.url())
    })
    await page.goto('/?dir=Documents')
    const file = page.locator('table').getByText('sample.pdf')
    await expect(file).toBeVisible()
    expect(
      assets.some((url) =>
        /\/(ViewerPane|HermesChatPane|PdfReader|BookReader|MarkdownDocument)-/.test(url),
      ),
    ).toBe(false)

    await file.click()
    await expect(page.getByTestId('pdf-canvas')).toBeVisible()
    expect(assets.some((url) => /\/ViewerPane-[^/]+\.js$/.test(url))).toBe(true)
    expect(assets.some((url) => /\/PdfReader-[^/]+\.js$/.test(url))).toBe(true)
    expect(assets.some((url) => /\/PdfReader-[^/]+\.css$/.test(url))).toBe(true)
    expect(assets.some((url) => /\/(BookReader|MarkdownDocument)-/.test(url))).toBe(false)
  })

  test('can close a viewer while its code is still downloading', async ({ page }) => {
    test.skip(process.env.E2E_DEV === '1', 'Checks production code splitting')
    let pending: Route | undefined
    await page.route('**/assets/ViewerPane-*.js', (route) => {
      pending = route
    })
    await page.goto('/?dir=Documents')
    await page.locator('table').getByText('sample.pdf').click()
    const loading = page.getByRole('dialog', { name: 'File viewer' })
    await expect(loading.getByRole('status')).toHaveText('Loading viewer…')
    await expect(loading.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
    await expect.poll(() => !!pending).toBe(true)
    await page.keyboard.press('Escape')
    await expect(loading).not.toBeVisible()
    await expect(page).not.toHaveURL(/viewing=/)
    await pending!.abort()
    await expect(page.getByTestId('pdf-canvas')).not.toBeVisible()
  })

  test('shows a dismissible error when viewer code cannot be loaded', async ({ page }) => {
    test.skip(process.env.E2E_DEV === '1', 'Checks production code splitting')
    await page.route('**/assets/ViewerPane-*.js', (route) => route.abort())
    await page.goto('/?dir=Documents')
    await page.locator('table').getByText('sample.pdf').click()
    const failed = page.getByRole('dialog', { name: 'File viewer' })
    await expect(failed.getByRole('alert')).toContainText('Unable to load viewer')
    await failed.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(failed).not.toBeVisible()
    await expect(page).not.toHaveURL(/viewing=/)
    await expect(page.locator('table').getByText('sample.pdf')).toBeVisible()
    await page.unroute('**/assets/ViewerPane-*.js')
    await page.reload()
    await page.locator('table').getByText('sample.pdf').click()
    await expect(page.getByTestId('pdf-canvas')).toBeVisible()
  })

  test('opens PDF viewer when clicking a PDF file', async ({ page }) => {
    await page.goto('/?dir=Documents')
    await page.locator('table').getByText('sample.pdf').click()
    await expect(page.getByTestId('pdf-canvas')).toBeVisible()
  })

  test('does not duplicate PDF filename in reader toolbar', async ({ page }) => {
    await page.goto('/?dir=Documents&viewing=Documents%2Fsample.pdf')
    await expect(page.getByTestId('reader-dialog').locator('header')).not.toContainText(
      'sample.pdf',
    )
  })

  test('uses compact derp-reader toolbar controls', async ({ page }) => {
    await page.goto('/?dir=Documents&viewing=Documents%2Fsample.pdf')
    await expect(page.getByTestId('reader-page-indicator')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Enter fullscreen' })).toBeVisible()
    await expect(page.locator('[title="Download"]')).not.toBeVisible()
  })

  test('shows page jump and zoom controls', async ({ page }) => {
    await page.goto('/?dir=Documents&viewing=Documents%2Fsample.pdf')
    await page.getByTestId('reader-page-indicator').click()
    await expect(page.getByTestId('reader-page-input')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByTestId('reader-settings-button').click()
    await expect(page.getByRole('button', { name: 'Reader zoom in' })).toBeVisible()
  })

  test('closing viewer returns to file list', async ({ page }) => {
    await page.goto('/?dir=Documents&viewing=Documents%2Fsample.pdf')
    await expect(page.getByTestId('pdf-canvas')).toBeVisible()

    await page.locator('button[title="Close"]').click()
    await expect(page.getByTestId('pdf-canvas')).not.toBeVisible()
    await expect(page.locator('table').getByText('sample.pdf')).toBeVisible()
    await expect(page).not.toHaveURL(/viewing=/)
  })
})
