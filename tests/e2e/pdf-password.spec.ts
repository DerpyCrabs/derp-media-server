import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const encryptedPdf = fs.readFileSync(path.resolve(__dirname, '../fixtures/password-protected.pdf'))
test('password-protected PDFs accept a retry and do not remember the password after reload', async ({
  page,
}) => {
  await page.route('**/api/media/Documents/reader.pdf', (route) =>
    route.fulfill({ body: encryptedPdf, contentType: 'application/pdf' }),
  )
  await page.goto('/?dir=Documents&viewing=Documents%2Freader.pdf')
  const dialog = page.getByRole('dialog', { name: 'Unlock PDF', exact: true })
  await dialog.getByLabel('PDF password', { exact: true }).fill('incorrect')
  await dialog.getByRole('button', { name: 'Unlock', exact: true }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Incorrect password. Try again.')
  await expect(page.getByLabel('PDF password', { exact: true })).toBeFocused()
  await page.getByLabel('PDF password', { exact: true }).fill('test-password')
  await page.getByLabel('PDF password', { exact: true }).press('Enter')
  await expect(dialog).not.toBeVisible()
  await expect(page.getByTestId('pdf-text-layer').first()).toContainText('Selectable reader text')
  await page.reload()
  await expect(page.getByRole('dialog', { name: 'Unlock PDF', exact: true })).toBeVisible()
  await expect(page.getByLabel('PDF password', { exact: true })).toHaveValue('')
})

test('cancelling password entry closes the reader and a later open prompts again', async ({
  page,
}) => {
  await page.route('**/api/media/Documents/reader.pdf', (route) =>
    route.fulfill({ body: encryptedPdf, contentType: 'application/pdf' }),
  )
  const url = '/?dir=Documents&viewing=Documents%2Freader.pdf'
  await page.goto(url)
  await page
    .getByRole('dialog', { name: 'Unlock PDF', exact: true })
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
  await expect(page.getByTestId('reader-dialog')).not.toBeVisible()
  await page.goto(url)
  await expect(page.getByRole('dialog', { name: 'Unlock PDF', exact: true })).toBeVisible()
})
