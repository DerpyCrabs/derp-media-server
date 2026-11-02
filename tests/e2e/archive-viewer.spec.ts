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
    const viewer = page.getByLabel('Archive contents', { exact: true })
    await expect(viewer.locator('[data-file-path="source"]')).toBeVisible()
    await viewer.locator('[data-file-path="source"]').click()
    await viewer.locator('[data-file-path="source/nested"]').click()
    await expect(viewer.getByText('keep.txt', { exact: true })).toBeVisible()
    await viewer
      .locator('[data-file-path="source/nested/keep.txt"]')
      .click({ modifiers: ['Control'] })
    await expect(viewer.locator('thead')).toHaveCount(0)
    await expect(viewer.getByRole('checkbox')).toHaveCount(0)
    await viewer.getByRole('button', { name: 'Back to folder' }).click()
    await viewer.getByRole('button', { name: 'Filter archive' }).click()
    await viewer.getByRole('searchbox', { name: 'Filter this folder', exact: true }).fill('KEEP')
    await expect(viewer.getByText('nested/keep.txt', { exact: true })).toBeVisible()
    await expect(viewer.getByText('leave.txt', { exact: true })).toHaveCount(0)
    await viewer.getByRole('button', { name: 'Extract (1)…' }).click()
    const destination = page.getByRole('dialog').filter({ hasText: `Extract Bundle.${extension}` })
    await destination.getByRole('button', { name: 'out', exact: true }).click()
    await destination.getByRole('button', { name: 'Extract here' }).click()
    await expect
      .poll(async () =>
        (
          await request.get(
            `/api/files/text?path=${encodeURIComponent(dir + '/out/source/nested/keep.txt')}`,
          )
        ).ok(),
      )
      .toBeTruthy()
    await expect(viewer.getByRole('article')).toHaveCount(0)
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
  const viewer = page.getByLabel('Archive contents', { exact: true })
  await viewer.getByRole('button', { name: 'Extract…' }).click()
  await page.getByRole('button', { name: 'Extract here', exact: true }).click()
  const conflict = page.getByRole('dialog').filter({ hasText: 'already exists' })
  await expect(conflict).toBeVisible()
  await conflict.getByRole('checkbox', { name: 'Apply to remaining conflicts' }).check()
  await conflict.getByRole('button', { name: 'Keep both', exact: true }).click()
  await expect(conflict).toHaveCount(0)
  await expect
    .poll(async () =>
      (
        await request.get(
          `/api/files/text?path=${encodeURIComponent(dir + '/source/leave (2).txt')}`,
        )
      ).ok(),
    )
    .toBeTruthy()
  await expect(viewer.getByRole('article')).toHaveCount(0)
  const files = await (
    await request.get(`/api/files?dir=${encodeURIComponent(dir + '/source')}`)
  ).json()
  expect(files.files.map((file: { name: string }) => file.name)).toContain('leave (2).txt')
})

test('archive reuses the folder grid and supports selection on a phone without opening the file', async ({
  page,
  request,
}) => {
  const { dir } = await archive(request, 'zip')
  await page.goto(`/?dir=${encodeURIComponent(dir)}`)
  await page.getByRole('button', { name: 'Display options' }).click()
  await page.getByRole('menuitemradio', { name: 'Grid view', exact: true }).click()
  await page.locator(`[data-file-path="${dir}/Bundle.zip"]`).click()
  const viewer = page.getByLabel('Archive contents', { exact: true })
  await expect(viewer.locator('table')).toHaveCount(0)
  await viewer.locator('[data-file-path="source"]').click()
  await page.setViewportSize({ width: 390, height: 844 })
  await viewer.getByRole('button', { name: 'More actions for leave.txt', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Select', exact: true }).click()
  await expect(page.getByLabel('Archive file preview', { exact: true })).toHaveCount(0)
  await expect(viewer.locator('[data-file-path="source/leave.txt"]')).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(viewer.getByRole('button', { name: 'Extract (1)…' })).toBeVisible()
})
