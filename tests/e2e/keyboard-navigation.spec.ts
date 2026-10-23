import { test, expect } from '@playwright/test'

test('folder dialog contains keyboard focus and Escape returns it to the trigger', async ({
  page,
}) => {
  await page.goto('/?dir=Notes')
  const trigger = page.locator('button[title="Create new folder"]')
  await trigger.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  const name = dialog.getByPlaceholder('Folder name')
  await expect(name).toBeFocused()
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    await expect
      .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true)
  }
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Shift+Tab')
    await expect
      .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('search can open, select a result, and dismiss entirely with the keyboard', async ({
  page,
}) => {
  await page.goto('/')
  const trigger = page.getByTestId('classic-file-search-trigger')
  await trigger.focus()
  await page.keyboard.press('Enter')
  const palette = page.getByTestId('file-search-palette')
  const input = palette.getByRole('combobox')
  await expect(input).toBeFocused()
  await page.keyboard.type('Videos')
  await expect(palette.getByRole('option').filter({ hasText: 'Videos' }).first()).toBeVisible()
  const options = palette.getByRole('option')
  await expect(options.first()).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowDown')
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowUp')
  await expect(options.first()).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/dir=Videos/)
  await expect(page.locator('table').getByText('sample.mp4', { exact: true })).toBeVisible()
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(input).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(palette).toHaveCount(0)
  await expect(trigger).toBeFocused()
})
