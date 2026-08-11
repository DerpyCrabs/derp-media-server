import { expect, test, type Locator, type Page } from '@playwright/test'

import { getWindowGroups } from './workspace-layout-helpers'

type ParitySurface = Readonly<{
  name: string
  open(page: Page): Promise<{
    content: Locator
    enterNested(): Promise<void>
    back(): Promise<void>
    forward(): Promise<void>
    keyboardSelection?(): Promise<void>
    cleanup?(): Promise<void>
  }>
  parentFile: string
  nestedFile: string
}>

const surfaces: readonly ParitySurface[] = [
  {
    name: 'Library',
    parentFile: 'welcome.md',
    nestedFile: 'nested-note.md',
    async open(page) {
      await page.goto('/?dir=Notes')
      const content = page.getByTestId('file-browser')
      return {
        content,
        async enterNested() {
          await content.locator('table').getByText('subfolder', { exact: true }).click()
        },
        async back() {
          await page.goBack()
        },
        async forward() {
          await page.goForward()
        },
      }
    },
  },
  {
    name: 'Workspace pane',
    parentFile: 'welcome.md',
    nestedFile: 'nested-note.md',
    async open(page) {
      await page.goto('/workspace')
      const content = getWindowGroups(page).first().locator('.workspace-window-content')
      await expect(content.locator('table').getByText('Notes', { exact: true })).toBeVisible()
      await content.locator('table').getByText('Notes', { exact: true }).click()
      return {
        content,
        async enterNested() {
          await content.locator('table').getByText('subfolder', { exact: true }).click()
        },
        async back() {
          const row = content.locator('[data-explorer-key]').filter({ hasText: 'nested-note.md' })
          await row.focus()
          await page.keyboard.press('Alt+ArrowLeft')
        },
        async forward() {
          const row = content.locator('[data-explorer-key]').filter({ hasText: 'welcome.md' })
          await row.focus()
          await page.keyboard.press('Alt+ArrowRight')
        },
      }
    },
  },
  {
    name: 'Grant browser',
    parentFile: 'public-doc.txt',
    nestedFile: 'nested.txt',
    async open(page) {
      const created = await page.request.post('/api/shares', {
        data: { path: 'SharedContent', isDirectory: true },
      })
      expect(created.ok()).toBe(true)
      const payload = (await created.json()) as {
        share: { token: string; passcode?: string }
      }
      const { token, passcode } = payload.share
      const shareUrl = `/share/${token}${passcode ? `?p=${encodeURIComponent(passcode)}` : ''}`
      await page.goto(shareUrl)
      const content = page.getByTestId('share-file-browser')
      return {
        content,
        async keyboardSelection() {
          const row = content.locator('tr').filter({ hasText: 'public-doc.txt' })
          await row.focus()
          await page.keyboard.press('Space')
          await expect(row).toHaveAttribute('aria-selected', 'true')
        },
        async enterNested() {
          await content.locator('table').getByText('subfolder', { exact: true }).click()
        },
        async back() {
          await page.goBack()
        },
        async forward() {
          await page.goForward()
        },
        async cleanup() {
          await page.request.post('/api/shares/delete', { data: { token } })
        },
      }
    },
  },
]

for (const surface of surfaces) {
  test(`${surface.name} follows shared nested navigation and history parity`, async ({ page }) => {
    const scenario = await surface.open(page)
    const fileInTable = (name: string) =>
      scenario.content.locator('table').getByText(name, { exact: true })
    try {
      await expect(fileInTable(surface.parentFile)).toBeVisible()
      await scenario.keyboardSelection?.()
      await scenario.enterNested()
      await expect(fileInTable(surface.nestedFile)).toBeVisible()

      await scenario.back()
      await expect(fileInTable(surface.parentFile)).toBeVisible()

      await scenario.forward()
      await expect(fileInTable(surface.nestedFile)).toBeVisible()
    } finally {
      await scenario.cleanup?.()
    }
  })
}
