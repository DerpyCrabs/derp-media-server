import { test, expect, type APIRequestContext } from '@playwright/test'

async function create(request: APIRequestContext, path: string, type = 'file') {
  const response = await request.post('/api/files/create', { data: { path, type, content: path } })
  expect(response.ok(), await response.text()).toBeTruthy()
}

test('bulk selection, ZIP creation and browsing work in the allowlist web client', async ({
  page,
  request,
}) => {
  const dir = `Notes/tools-zip-${Date.now()}`
  await create(request, dir, 'folder')
  await create(request, `${dir}/a.txt`)
  await create(request, `${dir}/b.txt`)
  await page.goto(`/?dir=${encodeURIComponent(dir)}`)
  await page
    .locator('table tr')
    .filter({ hasText: 'a.txt' })
    .click({ modifiers: ['Meta'] })
  await page
    .locator('table tr')
    .filter({ hasText: 'b.txt' })
    .click({ modifiers: ['Shift'] })
  await page.getByRole('button', { name: 'File actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Create archive…', exact: true }).click()
  await page.getByRole('button', { name: 'Create archive', exact: true }).click()
  await expect
    .poll(async () =>
      (
        await request.get(`/api/files/archive?path=${encodeURIComponent(dir + '/Archive.zip')}`)
      ).ok(),
    )
    .toBeTruthy()
  await expect(page.getByRole('dialog', { name: 'File operations', exact: true })).not.toBeVisible()
  await expect(page.locator('table').getByText('Archive.zip')).toBeVisible()
  await page.locator('[data-testid=file-browser]').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Escape')
  await page.locator('table').getByText('Archive.zip', { exact: true }).click()
  await expect(
    page.getByLabel('Archive contents').getByText('a.txt', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByLabel('Archive contents').getByText('b.txt', { exact: true }),
  ).toBeVisible()
})

test('batch conflicts support keep both and cancellation without removing sources', async ({
  page,
  request,
}) => {
  const dir = `Notes/tools-conflicts-${Date.now()}`
  await create(request, dir, 'folder')
  await create(request, `${dir}/out`, 'folder')
  await create(request, `${dir}/a.txt`)
  await create(request, `${dir}/out/a.txt`)
  const response = await request.post('/api/file-jobs', {
    data: { operation: 'copy', paths: [`${dir}/a.txt`], destination: `${dir}/out` },
  })
  expect(response.ok()).toBeTruthy()
  const { id } = (await response.json()) as { id: string }
  await page.goto(`/?dir=${encodeURIComponent(dir)}`)
  const conflict = page.getByRole('dialog', { name: '“a.txt” already exists', exact: true })
  await expect(conflict).toBeVisible()
  await expect(conflict.getByText(`${dir}/a.txt`, { exact: true })).toBeVisible()
  await expect(conflict.getByText(`${dir}/out/a.txt`, { exact: true })).toBeVisible()
  await expect(conflict.getByText('Apply to remaining conflicts')).toHaveCount(0)
  await conflict.getByRole('button', { name: 'Keep both', exact: true }).click()
  await expect(conflict).toHaveCount(0)
  await expect
    .poll(
      async () =>
        (
          (await (await request.get('/api/file-jobs')).json()) as { id: string; status: string }[]
        ).find((job) => job.id === id)?.status,
    )
    .toBe('completed')
  const files = (await (
    await request.get(`/api/files?dir=${encodeURIComponent(dir + '/out')}`)
  ).json()) as { files: { name: string }[] }
  expect(files.files.map((file) => file.name)).toContain('a (2).txt')
  await page.getByRole('button', { name: 'File actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'File operations', exact: true }).click()
  await expect(page.getByRole('article')).toHaveCount(0)
  await page.keyboard.press('Escape')
  const moving = await request.post('/api/file-jobs', {
    data: { operation: 'move', paths: [`${dir}/a.txt`], destination: `${dir}/out` },
  })
  const move = (await moving.json()) as { id: string }
  await expect
    .poll(
      async () =>
        (
          (await (await request.get('/api/file-jobs')).json()) as { id: string; status: string }[]
        ).find((job) => job.id === move.id)?.status,
    )
    .toBe('conflict')
  expect((await request.post(`/api/file-jobs/${move.id}/cancel`, { data: {} })).ok()).toBeTruthy()
  await expect
    .poll(
      async () =>
        (
          (await (await request.get('/api/file-jobs')).json()) as { id: string; status: string }[]
        ).find((job) => job.id === move.id)?.status,
    )
    .toBe('cancelled')
  expect(
    (await request.get(`/api/files/text?path=${encodeURIComponent(dir + '/a.txt')}`)).ok(),
  ).toBeTruthy()
})

test('location and properties do not expose native controls in a browser', async ({
  page,
  request,
}) => {
  const dir = `Notes/tools-location-${Date.now()}`
  await create(request, dir, 'folder')
  await create(request, `${dir}/note.txt`)
  await page.goto('/?dir=Notes')
  await page.getByRole('button', { name: 'File actions', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Open terminal here' })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'Edit location', exact: true }).click()
  await page.getByRole('textbox', { name: 'Location', exact: true }).fill(dir)
  await page.getByRole('textbox', { name: 'Location', exact: true }).press('Enter')
  await expect(page.locator('table').getByText('note.txt')).toBeVisible()
  await page
    .locator('table tr')
    .filter({ hasText: 'note.txt' })
    .click({ modifiers: ['Control'] })
  await page.getByRole('button', { name: 'File actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Properties', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText(`${dir}/note.txt`)
  await expect(page.getByRole('dialog')).toContainText('Read and write')
})

test('hidden files stay visible across navigation and reload, and Ctrl+H hides them again', async ({
  page,
  request,
}) => {
  const dir = `Notes/hidden-${Date.now()}`
  await create(request, dir, 'folder')
  await create(request, `${dir}/child`, 'folder')
  await create(request, `${dir}/.secret.txt`)
  await create(request, `${dir}/child/.nested.txt`)
  await page.goto(`/?dir=${encodeURIComponent(dir)}`)
  await expect(page.locator('table').getByText('.secret.txt', { exact: true })).toBeVisible()
  await page.locator('table').getByText('child', { exact: true }).click()
  await expect(page.locator('table').getByText('.nested.txt', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.locator('table').getByText('.nested.txt', { exact: true })).toBeVisible()
  await page.getByTestId('file-browser').focus()
  await page.keyboard.press('Control+h')
  await expect(page.locator('table').getByText('.nested.txt', { exact: true })).toHaveCount(0)
})

test('folder filtering and F2 rename work without opening the file', async ({ page, request }) => {
  const dir = `Notes/filter-${Date.now()}`
  await create(request, dir, 'folder')
  await create(request, `${dir}/alpha.txt`)
  await create(request, `${dir}/beta.txt`)
  await page.goto(`/?dir=${encodeURIComponent(dir)}`)
  await page.getByTestId('file-browser').focus()
  await page.keyboard.press('Control+f')
  const filter = page.getByRole('searchbox', { name: 'Filter this folder' })
  await expect(filter).toBeFocused()
  await filter.fill('ALPHA')
  await expect(page.locator('table').getByText('beta.txt', { exact: true })).toHaveCount(0)
  await expect(page.locator('table').getByText('alpha.txt', { exact: true })).toBeVisible()
  await filter.fill('missing')
  await expect(page.locator('table').getByText('alpha.txt', { exact: true })).toHaveCount(0)
  await expect(page.locator('table').getByText('beta.txt', { exact: true })).toHaveCount(0)
  await filter.fill('alpha')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('F2')
  const name = page.getByPlaceholder('New name')
  await expect(name).toBeFocused()
  expect(
    await name.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd]),
  ).toEqual([0, 5])
  await page.keyboard.type('renamed')
  await expect(name).toHaveValue('renamed.txt')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Close folder filter' }).click()
  await expect(page.locator('table').getByText('renamed.txt', { exact: true })).toBeVisible()
  await expect(page.locator('table').getByText('beta.txt', { exact: true })).toBeVisible()
})

test('unrecognized text files can be opened as text, with binary content rejected', async ({
  page,
  request,
}) => {
  const dir = `Notes/unknown-${Date.now()}`
  await create(request, dir, 'folder')
  await create(request, `${dir}/plain.custom`)
  await page.goto(`/?dir=${encodeURIComponent(dir)}`)
  await page.locator('table').getByText('plain.custom', { exact: true }).click()
  await page.getByRole('button', { name: 'Open as text', exact: true }).click()
  await expect(page.locator('[data-testid=plain-text-document] [role=textbox]')).toHaveText(
    `${dir}/plain.custom`,
  )
  const binary = await request.post('/api/files/create', {
    data: { path: `${dir}/binary.custom`, type: 'file', content: 'a\u0000b' },
  })
  expect(binary.ok()).toBe(true)
  const response = await request.get(
    `/api/files/text?path=${encodeURIComponent(`${dir}/binary.custom`)}`,
  )
  expect(response.status()).toBe(400)
  expect((await response.json()).error).toContain('binary')
})

test('file context menus expose properties without entering selection mode', async ({
  page,
  request,
}) => {
  const dir = `Notes/context-${Date.now()}`
  await create(request, dir, 'folder')
  await create(request, `${dir}/note.txt`)
  await page.goto(`/?dir=${encodeURIComponent(dir)}`)
  const row = page.locator('tr[data-file-path]').filter({ hasText: 'note.txt' })
  await row.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Properties', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText(`${dir}/note.txt`)
})
