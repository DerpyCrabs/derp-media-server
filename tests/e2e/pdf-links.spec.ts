import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
const linkedPdf = readFileSync('tests/fixtures/linked.pdf')
test('PDF links navigate inside the reader, preserve zoom and expose external URLs safely', async ({
  page,
}) => {
  await page.route('**/api/reader-preferences', (route) =>
    route.fulfill({
      json:
        route.request().method() === 'GET'
          ? { preferences: { selectionMode: 'text' }, revision: 0 }
          : { revision: 1 },
    }),
  )
  await page.route('**/api/media/Documents/reader.pdf', (route) =>
    route.fulfill({ body: linkedPdf, contentType: 'application/pdf' }),
  )
  await page.goto('/?dir=Documents&viewing=Documents%2Freader.pdf')
  const first = page.locator('[data-reader-page-index="0"]').getByTestId('pdf-annotations')
  const link = first.getByRole('link', { name: 'Go to page three' })
  await expect(link).toBeVisible()
  const external = first.locator('a[href="https://example.org/guide"]')
  await expect(external).toHaveAttribute('target', '_blank')
  await expect(external).toHaveAttribute('rel', 'noopener noreferrer')
  const before = await page.getByTestId('pdf-canvas').first().boundingBox()
  await link.click()
  await expect(page.getByTestId('reader-page-indicator')).toContainText('Page 3 / 3')
  await expect(page).toHaveURL(/viewing=Documents%2Freader.pdf/)
  const third = page.locator('[data-reader-page-index="2"]').getByTestId('pdf-annotations')
  await third.getByRole('link', { name: 'Return to the beginning' }).click()
  await expect(page.getByTestId('reader-page-indicator')).toContainText('Page 1 / 3')
  expect((await page.getByTestId('pdf-canvas').first().boundingBox())?.width).toBe(before?.width)
  await expect(page.getByTestId('pdf-text-layer').first()).toContainText('Plain selectable passage')
  await page.getByRole('button', { name: 'Reader settings', exact: true }).click()
  await page.getByRole('button', { name: 'image', exact: true }).click()
  await expect(page.getByTestId('pdf-annotations')).toHaveCount(0)
  await page.getByRole('button', { name: 'Reader settings', exact: true }).click()
  await page.getByRole('button', { name: 'text', exact: true }).click()
  await expect(first).toBeVisible()
})
