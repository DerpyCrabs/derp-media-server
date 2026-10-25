import { test, expect, type APIRequestContext } from '@playwright/test'

async function create(request: APIRequestContext, path: string, type = 'file') {
  const response = await request.post('/api/files/create', {
    data: { path, type, content: `Content of ${path}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
}
async function complete(request: APIRequestContext, id: string) {
  await expect
    .poll(async () => {
      const jobs = await (await request.get('/api/file-jobs')).json()
      return jobs.find((job: { id: string }) => job.id === id)?.status
    })
    .toBe('completed')
}
async function archive(request: APIRequestContext, extension: string) {
  const dir = `Notes/archive-${extension}-${Date.now()}`
  await create(request, dir, 'folder')
  await create(request, `${dir}/source`, 'folder')
  await create(request, `${dir}/source/nested`, 'folder')
  await create(request, `${dir}/source/nested/keep.txt`)
  await create(request, `${dir}/source/leave.txt`)
  await create(request, `${dir}/out`, 'folder')
  const response = await request.post('/api/file-jobs', {
    data: {
      operation: 'createArchive',
      paths: [`${dir}/source`],
      destination: dir,
      name: `Bundle.${extension}`,
    },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  await complete(request, (await response.json()).id)
  return { dir, path: `${dir}/Bundle.${extension}` }
}
for (const extension of ['zip', 'tar.gz', 'tar.xz']) {
  test(`browse ${extension} folders and extract only selected content`, async ({
    page,
    request,
  }) => {
    const { dir, path } = await archive(request, extension)
    await page.goto(`/?dir=${encodeURIComponent(dir)}&viewing=${encodeURIComponent(path)}`)
    const viewer = page.getByRole('dialog', { name: 'Archive contents' })
    await expect(viewer.getByText('2 files', { exact: false })).toBeVisible()
    await viewer.getByRole('button', { name: 'source', exact: true }).click()
    await viewer.getByRole('button', { name: 'nested', exact: true }).click()
    await expect(viewer.getByText('keep.txt', { exact: true })).toBeVisible()
    await viewer
      .getByRole('checkbox', { name: 'Select source/nested/keep.txt', exact: true })
      .check()
    await viewer.getByRole('button', { name: 'Parent archive folder' }).click()
    await viewer.getByRole('textbox', { name: 'Filter archive', exact: true }).fill('KEEP')
    await expect(viewer.getByText('nested/keep.txt', { exact: true })).toBeVisible()
    await expect(viewer.getByText('leave.txt', { exact: true })).toHaveCount(0)
    await viewer.getByRole('button', { name: 'Extract selected…' }).click()
    const destination = page
      .getByRole('dialog')
      .filter({ hasText: `Extract "Bundle.${extension}"` })
    await destination.getByRole('button', { name: 'out', exact: true }).click()
    await destination.getByRole('button', { name: 'Extract here' }).click()
    await expect(viewer.getByRole('status', { name: 'Extraction progress' })).toContainText(
      'completed',
    )
    const text = await request.get(
      `/api/files/text?path=${encodeURIComponent(dir + '/out/source/nested/keep.txt')}`,
    )
    expect(text.ok(), await text.text()).toBeTruthy()
    const files = await (
      await request.get(`/api/files?dir=${encodeURIComponent(dir + '/out/source')}`)
    ).json()
    expect(files.files.map((file: { name: string }) => file.name)).not.toContain('leave.txt')
  })
}
test('archive opens by ordinary file click and extracts all in its current folder with conflicts', async ({
  page,
  request,
}) => {
  const { dir } = await archive(request, 'tar')
  await page.goto(`/?dir=${encodeURIComponent(dir)}`)
  await page.locator('table tr').filter({ hasText: 'Bundle.tar' }).click()
  const viewer = page.getByRole('dialog', { name: 'Archive contents' })
  await viewer.getByRole('button', { name: 'Extract all…' }).click()
  await page.getByRole('button', { name: 'Extract here', exact: true }).click()
  await expect(viewer.getByText('Already exists:', { exact: false })).toBeVisible()
  await viewer.getByRole('checkbox', { name: 'Apply to all' }).check()
  await viewer.getByRole('button', { name: 'Keep both', exact: true }).click()
  await expect(viewer.getByRole('status', { name: 'Extraction progress' })).toContainText(
    'completed',
  )
  const files = await (
    await request.get(`/api/files?dir=${encodeURIComponent(dir + '/source')}`)
  ).json()
  expect(files.files.map((file: { name: string }) => file.name)).toContain('leave (2).txt')
})
