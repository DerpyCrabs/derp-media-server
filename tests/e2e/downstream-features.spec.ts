import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      launchCalls: [] as unknown[],
      derpDesktop: {
        ready: async () => {},
        onOpen: () => () => {},
        onBeforeClose: (callback: () => Promise<unknown>) => {
          Object.assign(window, {
            requestClose: () => {
              void callback().then((result) => Object.assign(window, { closeResult: result }))
            },
          })
          return () => {}
        },
        applications: async () => [{ id: 'test-editor.desktop', name: 'Test Editor' }],
        openWith: async (path: string, app: string) => {
          ;(window as unknown as { launchCalls: unknown[] }).launchCalls.push({ path, app })
        },
        openDefault: async () => {},
        open: async () => {},
        openRoot: async () => {},
        copy: async () => {},
        drag: async () => {},
        paste: async () => 0,
        places: async () => [],
        hasFileClipboard: async () => false,
        importDrop: async () => 0,
        openDrop: async () => {},
        close: () => {},
      },
    })
  })
})

test('application chooser is usable at desktop and narrow widths', async ({ page }, info) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/desktop?mode=viewer&viewing=Notes%2Fwelcome.md')
    await page.getByRole('button', { name: 'Document actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Open with…', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Open with', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveCSS('opacity', '1')
    await page.screenshot({ path: info.outputPath(`chooser-${width}.png`), animations: 'disabled' })
    await dialog.getByRole('button', { name: 'Test Editor', exact: true }).click()
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { launchCalls: unknown[] }).launchCalls),
      )
      .toEqual([{ path: 'Notes/welcome.md', app: 'test-editor.desktop' }])
  }
})

test('native editor cancels close and saves before accepting close', async ({
  page,
  request,
}, info) => {
  const path = `Notes/close-port-${Date.now()}.txt`
  await request.post('/api/files/create', { data: { path, content: 'Original\n' } })
  await request.post('/api/settings/autoSave', {
    data: { filePath: path, enabled: false, readOnly: false },
  })
  try {
    await page.goto(`/desktop?mode=viewer&viewing=${encodeURIComponent(path)}`)
    const editor = page.getByRole('textbox', { name: /editor$/ })
    await editor.click()
    await page.keyboard.press('Control+a')
    await page.keyboard.insertText('Saved through close\n')
    const close = () =>
      page.evaluate(() => (window as unknown as { requestClose(): void }).requestClose())
    await close()
    const dialog = page.getByRole('alertdialog', { name: 'Save changes before closing?' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveCSS('opacity', '1')
    await page.screenshot({ path: info.outputPath('save-before-close.png') })
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { closeResult: unknown }).closeResult))
      .toBe(false)
    await expect(editor).toContainText('Saved through close')
    await close()
    await dialog.getByRole('button', { name: 'Save and close', exact: true }).click()
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { closeResult: unknown }).closeResult))
      .toBe(true)
    expect(
      (await (await request.get(`/api/files/text?path=${encodeURIComponent(path)}`)).json())
        .content,
    ).toBe('Saved through close\n')
  } finally {
    await request.post('/api/files/delete', { data: { path } })
  }
})

test('reveal selects and focuses the requested file', async ({ page }) => {
  const reveal = encodeURIComponent(
    JSON.stringify({ directory: 'Notes', paths: ['Notes/welcome.md'] }),
  )
  await page.goto(`/desktop?mode=browser&dir=Notes&reveal=${reveal}`)
  const row = page.locator('[data-file-path="Notes/welcome.md"]').first()
  await expect(row).toBeVisible()
  await expect(row).toBeFocused()
})

test('Open with submenu supports keyboard entry, navigation and return', async ({ page }) => {
  await page.goto('/desktop?mode=browser&dir=')
  await page.locator('[data-file-path="Notes"]').first().click({ button: 'right' })
  const trigger = page.getByRole('menuitem', { name: 'Open with...', exact: true })
  await trigger.focus()
  await page.keyboard.press('ArrowRight')
  const submenu = page.getByTestId('open-with-submenu')
  await expect(submenu.getByRole('menuitem').first()).toBeFocused()
  await page.keyboard.press('End')
  await expect(submenu.getByRole('menuitem').last()).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(submenu).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('second-tab previews fit locally without changing the owned layout', async ({
  browser,
}, info) => {
  const context = await browser.newContext()
  const writer = await context.newPage()
  const observer = await context.newPage()
  const id = `preview-port-${Date.now()}`
  try {
    await writer.goto(
      `http://localhost:${process.env.BATCH_ID ? 9200 + Number(process.env.BATCH_ID) : 5973}/workspace?ws=${id}`,
    )
    await writer.getByRole('button', { name: 'Open browser window', exact: true }).click()
    await expect(writer.locator('[data-taskbar-window-row]')).toHaveCount(2)
    await expect
      .poll(
        async () =>
          (await (await writer.request.get('/api/workspaces')).json()).records[id].snapshot.windows
            .length,
      )
      .toBe(2)
    await observer.setViewportSize({ width: 390, height: 844 })
    await observer.goto(writer.url())
    await expect(observer.getByTestId('workspace-ownership-notice')).toBeVisible()
    const before = (await (await writer.request.get('/api/workspaces')).json()).records[id].snapshot
    const row = observer.locator('[data-taskbar-window-row]').first()
    await row.click()
    await expect(row).toHaveAttribute('aria-current', 'true')
    await row.click({ button: 'right' })
    await expect(observer.getByTestId('workspace-taskbar-menu-close')).toBeDisabled()
    await expect(observer.getByTestId('workspace-taskbar-menu-minimize')).toBeDisabled()
    await observer.keyboard.press('Escape')
    await observer.screenshot({
      path: info.outputPath('local-preview-narrow.png'),
      animations: 'disabled',
    })
    expect(
      (await (await writer.request.get('/api/workspaces')).json()).records[id].snapshot,
    ).toEqual(before)
  } finally {
    await context.close()
  }
})

test('audio popup keeps its controls inside desktop and narrow viewports', async ({
  page,
}, info) => {
  await page.goto('/workspace?ws=audio-port-' + Date.now())
  await page.locator('[data-file-path="Music"]').first().click()
  await page.locator('[data-file-path="Music/track.mp3"]').first().click()
  await page.getByRole('button', { name: 'Open audio controls' }).click()
  const popup = page.getByTestId('workspace-audio-details')
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(popup).toBeVisible()
    await expect
      .poll(() =>
        popup.evaluate((element) => {
          const bounds = element.getBoundingClientRect()
          return (
            bounds.left >= 0 &&
            bounds.right <= innerWidth &&
            [...element.querySelectorAll('button,input')]
              .filter((control) => control.getClientRects().length > 0)
              .every((control) => {
                const rect = control.getBoundingClientRect()
                return rect.left >= bounds.left && rect.right <= bounds.right
              })
          )
        }),
      )
      .toBe(true)
    await page.screenshot({ path: info.outputPath(`audio-${width}.png`), animations: 'disabled' })
  }
})
