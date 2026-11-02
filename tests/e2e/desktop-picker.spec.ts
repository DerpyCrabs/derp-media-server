import { test, expect, type Page } from '@playwright/test'
import type { PickerRequest, DesktopTarget } from '../../src/desktop/bridge'

async function picker(page: Page, save = false) {
  await page.addInitScript(
    ({ save }) => {
      let onPicker: (request: PickerRequest) => void
      let onOpen: (target: DesktopTarget) => void
      Object.assign(window, {
        pickerResults: [] as unknown[],
        derpDesktop: {
          onPicker: (callback: typeof onPicker) => {
            onPicker = callback
            return () => {}
          },
          onOpen: (callback: typeof onOpen) => {
            onOpen = callback
            return () => {}
          },
          onBeforeClose: () => () => {},
          ready: async () => {
            onPicker({
              mode: save ? 'SaveFile' : 'OpenFile',
              directory: false,
              multiple: !save,
              name: save ? 'Untitled.txt' : '',
              acceptLabel: '',
              filter: 0,
              choices: [],
              filters: [
                { name: 'Text files', rules: [{ type: 0, value: '*.txt', patterns: ['*.txt'] }] },
                { name: 'All files', rules: [{ type: 0, value: '*', patterns: ['*'] }] },
              ],
            })
            onOpen({ path: 'Notes', isDirectory: true, mediaType: 'folder' })
          },
          pick: async (selection: unknown) => {
            ;(window as unknown as { pickerResults: unknown[] }).pickerResults.push(selection)
            return {}
          },
          places: async () => [
            { name: 'Library', path: '' },
            { name: 'Notes', path: 'Notes' },
          ],
          hasFileClipboard: async () => false,
          open: async () => {},
          copy: async () => {},
          drag: async () => {},
          close: () => {},
        },
      })
    },
    { save },
  )
  await page.goto('/desktop?mode=browser')
  await expect(page.getByRole('form', { name: 'File picker' })).toBeVisible()
}

for (const width of [1280, 390]) {
  test(`picker filters, selects and accepts without toolbar clutter at ${width}px`, async ({
    page,
    request,
  }) => {
    const name = `picker-${width}-${Date.now()}.TXT`
    await request.post('/api/files/upload?create_only=true', {
      multipart: {
        targetDir: 'Notes',
        file: { name, mimeType: 'text/plain', buffer: Buffer.from('picker fixture') },
      },
    })
    await page.setViewportSize({ width, height: 844 })
    await picker(page)
    const form = page.getByRole('form', { name: 'File picker' })
    await expect(form.getByRole('button', { name: 'Open', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'New file toolbar', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Paste files', exact: true })).toHaveCount(0)
    const row = page.locator('tr[data-file-path]').filter({ hasText: name })
    await row.click()
    await expect(form.getByRole('button', { name: 'Open', exact: true })).toBeEnabled()
    await row.press('Enter')
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { pickerResults: { paths: string[] }[] }).pickerResults.at(-1)
              ?.paths,
        ),
      )
      .toEqual([`Notes/${name}`])
    await page.getByRole('button', { name: 'File type', exact: true }).click()
    await page.getByRole('option', { name: 'All files', exact: true }).click()
    await expect(form.getByRole('button', { name: 'Open', exact: true })).toBeDisabled()
    const box = await form.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    await request.delete(`/api/files?path=${encodeURIComponent(`Notes/${name}`)}`)
  })
}

test('save picker uses a filename and disables empty submission', async ({ page }) => {
  await picker(page, true)
  const name = page.getByRole('textbox', { name: 'File name', exact: true })
  await expect(name).toHaveValue('Untitled.txt')
  await name.fill('')
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await name.fill('report.txt')
  await name.press('Enter')
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { pickerResults: { name: string }[] }).pickerResults.at(-1)?.name,
      ),
    )
    .toBe('report.txt')
})
