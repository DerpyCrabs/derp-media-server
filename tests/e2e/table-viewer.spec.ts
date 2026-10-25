import { expect, test, type Page, type APIRequestContext } from '@playwright/test'
async function openTable(
  page: Page,
  request: APIRequestContext,
  content: string,
  extension = 'csv',
) {
  const path = `Notes/table-${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`
  expect((await request.post('/api/files/create', { data: { path, content } })).ok()).toBe(true)
  await request.post('/api/settings/autoSave', {
    data: { filePath: path, enabled: false, readOnly: false },
  })
  await page.goto(`/?dir=Notes&viewing=${encodeURIComponent(path)}`)
  await expect(page.getByRole('table', { name: 'Delimited text table' })).toBeVisible()
  await expect(page.getByText('Preparing table…', { exact: true })).toHaveCount(0)
  return path
}
test('table sorting and filtering preserve source while exact cell edits survive text switching and saving', async ({
  page,
  request,
}) => {
  const source =
    '\ufeffName;Code;Comment\r\nAlice;00123;"first\nsecond"\r\nBob;002;"keep;quoted"\r\n'
  const path = await openTable(page, request, source)
  const table = page.getByRole('table', { name: 'Delimited text table' })
  await expect(table.getByRole('columnheader', { name: 'Code' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cell B2', exact: true })).toHaveText('00123')
  await page.getByTitle('Sort by Code', { exact: true }).click()
  await expect(table.getByRole('row').nth(1)).toContainText('Bob')
  await page.getByRole('searchbox', { name: 'Filter table rows' }).fill('Alice')
  await expect(page.getByRole('button', { name: 'Cell A3', exact: true })).toHaveCount(0)
  expect(await (await request.get(`/api/media/${path}`)).text()).toBe(source)
  await page.getByRole('button', { name: 'Cell C2', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Cell value' })).toHaveValue('first\nsecond')
  await page.getByRole('textbox', { name: 'Cell value' }).fill('changed; "quoted"\nline')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page.getByRole('button', { name: 'Text', exact: true }).click()
  await expect(page.getByTestId('plain-text-document').getByRole('textbox')).toContainText(
    'changed; ""quoted""',
  )
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const expected = source.replace('"first\nsecond"', '"changed; ""quoted""\nline"')
  await expect
    .poll(async () =>
      Buffer.from(await (await request.get(`/api/media/${path}`)).body()).toString('utf8'),
    )
    .toBe(expected)
  await page.getByRole('button', { name: 'Table', exact: true }).click()
  await page.getByRole('button', { name: 'Cell C2', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Cell value' })).toHaveValue(
    'changed; "quoted"\nline',
  )
})
test('TSV cells support undo, redo and cancellation without coercing values', async ({
  page,
  request,
}) => {
  const path = await openTable(page, request, 'Name\tCode\nAlice\t00123\nBob\t2026-01-01\n', 'tsv')
  await page.getByRole('button', { name: 'Cell B2', exact: true }).click()
  await page.getByRole('textbox', { name: 'Cell value' }).fill('00045')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Cell B2', exact: true })).toHaveText('00045')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Cell B2', exact: true })).toHaveText('00123')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Cell B2', exact: true })).toHaveText('00045')
  await page.getByRole('button', { name: 'Cell B3', exact: true }).click()
  await page.getByRole('textbox', { name: 'Cell value' }).fill('oops')
  await page.getByRole('button', { name: 'Cancel cell edit', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Cell B3', exact: true })).toHaveText('2026-01-01')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect
    .poll(async () => (await request.get(`/api/media/${path}`)).text())
    .toBe('Name\tCode\nAlice\t00045\nBob\t2026-01-01\n')
  await page.getByRole('button', { name: 'Read only', exact: true }).click()
  await page.getByRole('button', { name: 'Cell B2', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Cell value' })).toHaveAttribute('readonly', '')
})
test('large tables virtualize rows and columns, preserve edits in browser recovery, and fit a narrow screen', async ({
  page,
  request,
}) => {
  const source = Array.from({ length: 5001 }, (_, row) =>
    Array.from({ length: 40 }, (_, column) =>
      row === 0 ? `Header ${column}` : `${row}:${column}`,
    ).join(','),
  ).join('\n')
  const path = await openTable(page, request, source)
  expect(
    await page.getByRole('table', { name: 'Delimited text table' }).getByRole('row').count(),
  ).toBeLessThan(60)
  expect(
    await page.getByRole('table', { name: 'Delimited text table' }).getByRole('cell').count(),
  ).toBeLessThan(1000)
  await page.getByRole('button', { name: 'Cell A2', exact: true }).click()
  await page.getByRole('textbox', { name: 'Cell value' }).fill('Recover this cell')
  await expect(
    page.getByText('Unsaved changes · Draft backed up in this browser', { exact: true }),
  ).toBeVisible()
  page.on('dialog', (dialog) => dialog.accept())
  await page.reload()
  await expect(page.getByRole('button', { name: 'Restore draft', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Restore draft', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Cell A2', exact: true })).toHaveText(
    'Recover this cell',
  )
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('searchbox', { name: 'Filter table rows' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('searchbox', { name: 'Filter table rows' }).fill('5000:39')
  await expect(page.getByRole('button', { name: 'Cell A5001', exact: true })).toHaveText('5000:0')
  expect(await (await request.get(`/api/media/${path}`)).text()).toBe(source)
})
test('malformed CSV shows a useful error and raw source remains editable', async ({
  page,
  request,
}) => {
  await openTable(page, request, 'Name,Value\nAlice,"unclosed\n')
  await page.getByRole('button', { name: 'Table options' }).click()
  await page.getByRole('combobox', { name: 'Table separator' }).selectOption(',')
  await expect(page.getByRole('alert')).toContainText('Unclosed quoted field')
  await page.getByRole('button', { name: 'Text', exact: true }).click()
  await expect(page.getByTestId('plain-text-document').getByRole('textbox')).toContainText(
    'Alice,"unclosed',
  )
})

test('keyboard navigation reaches virtual cells, edits with F2 and resets scroll after filtering', async ({
  page,
  request,
}) => {
  const content = Array.from({ length: 2001 }, (_, row) =>
    Array.from({ length: 30 }, (_, column) =>
      row ? `value-${row}-${column}` : `Column ${column}`,
    ).join(','),
  ).join('\n')
  await openTable(page, request, content)
  const first = page.getByRole('button', { name: 'Cell A2', exact: true })
  await first.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('button', { name: 'Cell B2', exact: true })).toBeFocused()
  await page.keyboard.press('Control+End')
  const last = page.getByRole('button', { name: 'Cell AD2001', exact: true })
  await expect(last).toBeFocused()
  await expect(last).toHaveText('value-2000-29')
  await page.keyboard.press('F2')
  await expect(page.getByRole('textbox', { name: 'Cell value' })).toBeFocused()
  await page.getByRole('textbox', { name: 'Cell value' }).fill('Last record edit')
  await page.keyboard.press('Control+Enter')
  await page.getByRole('searchbox', { name: 'Filter table rows' }).fill('value-1-0')
  const viewport = page.getByLabel('Table records', { exact: true })
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(0)
  await viewport.evaluate((element) => {
    element.scrollLeft = 0
  })
  await expect(page.getByRole('button', { name: 'Cell A2', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cell A2001', exact: true })).toHaveCount(0)
})
