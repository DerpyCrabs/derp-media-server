import { test, expect } from '@playwright/test'

test('favorite folders become shared Places and follow rename and removal without desktop mode', async ({
  page,
  request,
  context,
}) => {
  const name = `places-${Date.now()}`
  const base = `Notes/${name}`
  for (const folder of [
    base,
    `${base}/First`,
    `${base}/Second`,
    `${base}/First/Work`,
    `${base}/Second/Work`,
  ]) {
    expect(
      (await request.post('/api/files/create', { data: { path: folder, type: 'folder' } })).ok(),
    ).toBe(true)
  }
  expect(
    (
      await request.post('/api/files/create', {
        data: { path: `${base}/First/Work/note.txt`, type: 'file', content: 'saved folder' },
      })
    ).ok(),
  ).toBe(true)
  const second = await context.newPage()
  try {
    await page.goto(`/?dir=${encodeURIComponent(`${base}/First`)}`)
    await second.goto('/')
    expect((await (await request.get('/api/config')).json()).desktopMode).toBe(false)
    await page.locator('table').getByText('Work', { exact: true }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Favorite', exact: true }).click()
    await expect(second.getByRole('button', { name: 'Places', exact: true })).toBeVisible()
    await second.getByRole('button', { name: 'Places', exact: true }).click()
    await expect(second.getByRole('menuitem', { name: 'Work', exact: true })).toBeVisible()
    await expect(second.getByRole('menuitem', { name: 'Work', exact: true })).toBeFocused()
    await second.keyboard.press('Enter')
    await expect(second.locator(`[data-file-path="${base}/First/Work/note.txt"]`)).toBeFocused()
    await request.post('/api/settings/favorite', { data: { filePath: `${base}/Second/Work` } })
    await request.post('/api/settings/favorite', {
      data: { filePath: `${base}/First/Work/note.txt` },
    })
    await second.getByRole('button', { name: 'Places', exact: true }).click()
    await expect(
      second.getByRole('menuitem', { name: `Work ${base}/First/Work`, exact: true }),
    ).toBeVisible()
    await expect(
      second.getByRole('menuitem', { name: `Work ${base}/Second/Work`, exact: true }),
    ).toBeVisible()
    await expect(second.getByRole('menuitem', { name: 'note.txt', exact: true })).toHaveCount(0)
    await second.keyboard.press('End')
    await expect(
      second.getByRole('menuitem', { name: `Work ${base}/Second/Work`, exact: true }),
    ).toBeFocused()
    await second.keyboard.press('Escape')
    await expect(second.getByRole('button', { name: 'Places', exact: true })).toBeFocused()
    expect(
      (
        await request.post('/api/files/rename', {
          data: { oldPath: `${base}/First/Work`, newPath: `${base}/First/Renamed` },
        })
      ).ok(),
    ).toBe(true)
    await page.getByRole('button', { name: 'Places', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: 'Renamed', exact: true })).toBeVisible()
    await expect(
      page.getByRole('menuitem', { name: `Work ${base}/First/Work`, exact: true }),
    ).toHaveCount(0)
    expect(
      (await request.post('/api/files/delete', { data: { path: `${base}/First/Renamed` } })).ok(),
    ).toBe(true)
    await expect(page.getByRole('menuitem', { name: 'Renamed', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await request.post('/api/settings/favorite', { data: { filePath: `${base}/Second/Work` } })
    await expect
      .poll(async () =>
        (await (await request.get('/api/settings')).json()).favorites.some((path: string) =>
          path.startsWith(base),
        ),
      )
      .toBe(false)
  } finally {
    await second.close()
    await request.post('/api/files/delete', { data: { path: base } })
  }
})
