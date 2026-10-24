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
  await page.getByRole('button', { name: 'Files (2)', exact: true }).click()
  await page.getByRole('button', { name: 'Create ZIP…', exact: true }).click()
  await page.getByRole('button', { name: 'Create ZIP', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('completed')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.locator('table').getByText('Archive.zip')).toBeVisible()
  await page.getByRole('button', { name: /^Files/ }).click()
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page
    .locator('table tr')
    .filter({ hasText: 'Archive.zip' })
    .click({ modifiers: ['Control'] })
  await page.getByRole('button', { name: 'Files (1)', exact: true }).click()
  await page.getByRole('button', { name: 'Browse ZIP', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('2 entries')
  await expect(page.getByRole('dialog').getByText('a.txt', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog').getByText('b.txt', { exact: true })).toBeVisible()
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
  await page.getByRole('button', { name: 'Files', exact: true }).click()
  await page.getByRole('button', { name: 'Operations', exact: true }).click()
  const job = page.getByRole('article').filter({ hasText: `${dir}/out/a.txt` })
  await job.getByRole('button', { name: 'Keep both', exact: true }).click()
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
  await page.getByRole('button', { name: 'Files', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Open terminal here' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Go to location', exact: true }).click()
  await page.getByRole('textbox', { name: 'Location', exact: true }).fill(dir)
  await page.getByRole('button', { name: 'Go', exact: true }).click()
  await expect(page.locator('table').getByText('note.txt')).toBeVisible()
  await page
    .locator('table tr')
    .filter({ hasText: 'note.txt' })
    .click({ modifiers: ['Control'] })
  await page.getByRole('button', { name: 'Files (1)', exact: true }).click()
  await page.getByRole('button', { name: 'Properties', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText(`${dir}/note.txt`)
  await expect(page.getByRole('dialog')).toContainText('Editable')
})
