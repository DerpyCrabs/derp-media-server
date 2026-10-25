import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import type { WindowDefinition } from '@/lib/models/window-model'

function window(
  id: string,
  title: string,
  extra: Partial<WindowDefinition> = {},
): WindowDefinition {
  return {
    id,
    title,
    type: 'browser',
    source: { kind: 'local' },
    initialState: {},
    layout: { bounds: { x: 60, y: 70, width: 800, height: 600 }, zIndex: 1 },
    ...extra,
  }
}
async function seed(
  page: Page,
  request: APIRequestContext,
  windows: WindowDefinition[],
  canvas = false,
) {
  const id = `commands-${crypto.randomUUID()}`,
    clientId = `client-${id}`
  const snapshot = {
    workspaceType: canvas ? 'canvas' : 'desktop',
    windows,
    activeWindowId: windows.at(-1)?.id ?? null,
    activeTabMap: { group: windows.at(-1)?.id },
    nextWindowId: windows.length + 1,
    ...(canvas
      ? {
          canvas: {
            camera: { x: 0, y: 0, zoom: 1 },
            maximizedWindowId: null,
            windowSizeByType: {},
            nextZIndex: windows.length + 1,
          },
        }
      : {}),
  }
  expect(
    (await request.post('/api/workspaces/open', { data: { id, clientId, snapshot } })).ok(),
  ).toBe(true)
  await page.addInitScript((id) => sessionStorage.setItem('workspace-client-id', id), clientId)
  await page.goto(`/workspace?ws=${id}`)
  await expect(page.locator('[data-workspace-opened]')).toBeAttached()
  return { id, clientId }
}
const palette = (page: Page) =>
  page.getByRole('dialog', { name: 'Workspace commands', exact: true })
async function search(page: Page, query: string) {
  await page.keyboard.press('Control+Shift+P')
  await expect(palette(page)).toBeVisible()
  await palette(page).getByRole('combobox').fill(query)
}

test('finds a hidden document tab by path, activates it, and restores editor focus after Escape', async ({
  page,
  request,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await seed(page, request, [
    window('document', 'Project notes', {
      type: 'viewer',
      initialState: { viewing: 'Documents/readme.txt', dir: 'Documents' },
      tabGroupId: 'group',
    }),
    window('files', 'Files', { tabGroupId: 'group' }),
  ])
  await search(page, 'readme documents')
  await expect(palette(page).getByRole('option')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(palette(page)).toBeHidden()
  const editor = page.locator('[data-workspace-content-id="document"] .cm-content')
  await expect(editor).toBeVisible()
  await expect(editor).toBeFocused()
  await page.keyboard.press('Control+Shift+P')
  await expect(palette(page).getByRole('combobox')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(editor).toBeFocused()
  expect(errors).toEqual([])
})

test('restores a minimized window and searches all entries beyond the initial result limit', async ({
  page,
  request,
}) => {
  // Tabs share one group, so the large registry does not mount dozens of file browsers.
  const windows = Array.from({ length: 84 }, (_, index) =>
    window(`tab-${index}`, `Document ${index}`, { tabGroupId: 'group' }),
  )
  windows.push(
    window('target', 'Заметки о поездке', {
      initialState: { dir: 'Documents' },
      layout: { bounds: { x: 50, y: 60, width: 700, height: 500 }, minimized: true, zIndex: 0 },
    }),
  )
  await seed(page, request, windows)
  await page.keyboard.press('F1')
  await expect(palette(page).getByRole('option')).toHaveCount(80)
  await expect(palette(page)).toContainText('Type to narrow the list')
  await palette(page).getByRole('combobox').fill('documents')
  await expect(palette(page).getByRole('option')).toHaveCount(1)
  await expect(palette(page)).toContainText('Minimized')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-workspace-content-id="target"]')).toBeVisible()
  await expect(page.locator('[data-workspace-content-id="target"]')).toBeFocused()
})

test('settings entry, keyboard selection, file search and pinned-tab protection work on a narrow screen', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await seed(page, request, [window('pinned', 'Pinned documents', { tabPinned: true })])
  await page.getByRole('button', { name: 'Open settings' }).click()
  await page.getByRole('button', { name: /Workspace commands…/ }).click()
  await expect(palette(page).getByRole('combobox')).toBeFocused()
  await palette(page).getByRole('combobox').fill('close active')
  await expect(palette(page).getByRole('option')).toHaveAttribute('aria-disabled', 'true')
  await page.keyboard.press('Enter')
  await expect(palette(page)).toBeVisible()
  const bounds = await palette(page).boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  await palette(page).getByRole('combobox').fill('command')
  await page.keyboard.press('Control+End')
  const selected = palette(page).locator('[role="option"][aria-selected="true"]')
  await expect(selected).toContainText('Close active tab')
  await page.keyboard.press('Control+Home')
  await expect(selected).toContainText('New file browser')
  await palette(page).getByRole('combobox').fill('search files')
  await page.keyboard.press('Enter')
  await expect(palette(page)).toBeHidden()
  await expect(
    page.getByRole('dialog', { name: 'Search library and open a new window' }),
  ).toBeVisible()
})

test('canvas window search activates an offscreen tab and offers canvas-specific commands', async ({
  page,
  request,
}) => {
  await seed(
    page,
    request,
    [
      window('far', 'Far-away documents', {
        initialState: { dir: 'Documents' },
        layout: { bounds: { x: 10000, y: 9000, width: 800, height: 600 }, zIndex: 1 },
      }),
      window('near', 'Nearby files'),
    ],
    true,
  )
  await search(page, 'documents')
  await page.keyboard.press('Enter')
  const content = page.locator('[data-workspace-content-id="far"]')
  await expect(content).toBeInViewport()
  await expect(content).toBeFocused()
  await search(page, 'fit all')
  await page.keyboard.press('Enter')
  await expect(palette(page)).toBeHidden()
  await search(page, 'zoom to')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('slider', { name: 'Canvas zoom' })).toHaveValue('100')
})

test('read-only workspace commands cannot mutate windows and provide explicit takeover', async ({
  page,
  request,
}) => {
  const { id } = await seed(page, request, [window('files', 'Files')])
  expect(
    (
      await request.post('/api/workspaces/open', {
        data: { id, clientId: 'commands-other-tab', takeover: true },
      })
    ).ok(),
  ).toBe(true)
  await expect(page.getByText('Read only — workspace is open elsewhere')).toBeVisible()
  await search(page, 'new file browser')
  await expect(palette(page).getByRole('option')).toHaveAttribute('aria-disabled', 'true')
  await page.keyboard.press('Enter')
  await expect(palette(page)).toBeVisible()
  await palette(page).getByRole('combobox').fill('take control')
  await page.keyboard.press('Enter')
  await expect(page.getByText('Read only — workspace is open elsewhere')).toBeHidden()
  await search(page, 'new file browser')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-window-group]')).toHaveCount(2)
})
