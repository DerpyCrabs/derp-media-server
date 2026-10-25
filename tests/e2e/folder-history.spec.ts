import { test, expect } from '@playwright/test'
import {
  gotoWorkspace,
  getWindowGroups,
  openBrowserWindow,
  getDragHandle,
  dragFromTo,
} from './workspace-layout-helpers'

test('workspace folder history stays local and a new route replaces the forward branch', async ({
  page,
  request,
}) => {
  const name = `history-${Date.now()}`
  for (const path of [`Notes/${name}`, `Notes/${name}/First`, `Notes/${name}/Second`]) {
    expect((await request.post('/api/files/create', { data: { path, type: 'folder' } })).ok()).toBe(
      true,
    )
  }
  await gotoWorkspace(page)
  const url = page.url()
  const pane = getWindowGroups(page).first()
  const back = pane.getByRole('button', { name: 'Back to previous folder' })
  const forward = pane.getByRole('button', { name: 'Forward to next folder' })
  await expect(back).toBeDisabled()
  await expect(forward).toBeDisabled()
  await pane.locator('table').getByText('Notes', { exact: true }).click()
  await pane.locator('table').getByText(name, { exact: true }).click()
  await pane.locator('table').getByText('First', { exact: true }).click()
  await back.click()
  await expect(pane.locator('table').getByText('Second', { exact: true })).toBeVisible()
  await page.keyboard.press('Alt+ArrowRight')
  await expect(pane.getByTestId('directory-empty')).toBeVisible()
  await page.keyboard.press('Alt+ArrowLeft')
  await expect(pane.locator('table').getByText('Second', { exact: true })).toBeVisible()
  await pane.locator('table').getByText('Second', { exact: true }).click()
  await expect(forward).toBeDisabled()
  await expect(back).toBeEnabled()
  expect(page.url()).toBe(url)
})

test('split browser panes keep independent back and forward histories', async ({ page }) => {
  await gotoWorkspace(page)
  await openBrowserWindow(page)
  const groups = getWindowGroups(page)
  const source = await getDragHandle(groups.nth(1)).boundingBox()
  const target = await getDragHandle(groups.first()).boundingBox()
  if (!source || !target) throw new Error('Missing browser titlebars')
  await dragFromTo(
    page,
    source.x + source.width / 2,
    source.y + source.height / 2,
    target.x + target.width / 2,
    target.y + 16,
  )
  await expect(groups).toHaveCount(1)
  await page
    .locator('.workspace-tab-strip [data-workspace-tab-id]')
    .first()
    .click({ button: 'right' })
  await page.getByTestId('workspace-tab-menu-use-split-left').click()
  const left = page.getByTestId('workspace-split-left-pane')
  const right = page.getByTestId('workspace-split-right-pane')
  await left.locator('table').getByText('Notes', { exact: true }).click()
  await right.locator('table').getByText('Images', { exact: true }).click()
  await left.getByRole('button', { name: 'Back to previous folder' }).click()
  await expect(left.locator('table').getByText('Notes', { exact: true })).toBeVisible()
  await expect(right.locator('table').getByText('photo.png', { exact: true })).toBeVisible()
  await expect(left.getByRole('button', { name: 'Back to previous folder' })).toBeDisabled()
  await expect(right.getByRole('button', { name: 'Back to previous folder' })).toBeEnabled()
  await page.keyboard.press('Alt+ArrowRight')
  await expect(left.locator('table').getByText('todo.md', { exact: true })).toBeVisible()
  await expect(right.locator('table').getByText('photo.png', { exact: true })).toBeVisible()
})

for (const surface of ['media', 'workspace']) {
  test(`${surface} keyboard folder navigation retains focus through nested and empty folders`, async ({
    page,
    request,
  }) => {
    const name = `keyboard-folders-${surface}-${Date.now()}`
    const base = `Notes/${name}`
    for (const path of [base, `${base}/Inner`, `${base}/Inner/Empty`]) {
      expect(
        (await request.post('/api/files/create', { data: { path, type: 'folder' } })).ok(),
      ).toBe(true)
    }
    if (surface === 'workspace') {
      await gotoWorkspace(page)
      await page.locator('table').getByText('Notes', { exact: true }).click()
    } else await page.goto('/?dir=Notes')
    await page.locator(`[data-file-path="${base}"]`).focus()
    await page.keyboard.press('Enter')
    await expect(page.locator(`[data-file-path="${base}/Inner"]`)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator(`[data-file-path="${base}/Inner/Empty"]`)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-directory-viewport]')).toBeFocused()
    await page.keyboard.press('Alt+ArrowUp')
    await expect(page.locator(`[data-file-path="${base}/Inner/Empty"]`)).toBeFocused()
    await page.keyboard.press('Alt+ArrowUp')
    await expect(page.locator(`[data-file-path="${base}/Inner"]`)).toBeFocused()
  })
}
