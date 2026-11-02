import { test, expect } from '@playwright/test'

type RuntimeHost = Window & {
  mountSurface?: (target: Window) => Promise<void>
  unmountSurface?: (target: Window) => Promise<void>
  shutdownRuntime?: () => Promise<void>
}

test('one app runtime owns independent documents, menus, navigation and close lifetimes', async ({
  page,
}, testInfo) => {
  const errors: string[] = [],
    scripts: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scripts.push(request.url())
  })
  await page.addInitScript(() => {
    if (window === window.top) {
      Object.assign(window, {
        derpRuntime: {
          register(
            mount: (target: Window) => Promise<void>,
            unmount: (target: Window) => Promise<void>,
            shutdown: () => Promise<void>,
          ) {
            Object.assign(window, {
              mountSurface: mount,
              unmountSurface: unmount,
              shutdownRuntime: shutdown,
            })
          },
        },
      })
    } else {
      Object.assign(window, {
        derpSurface: { attach() {} },
        derpDesktop: {
          ready: async () => {},
          onOpen: () => () => {},
          onBeforeClose: () => () => {},
          open: async () => {},
          openRoot: async () => {},
          copy: async () => {},
          drag: async () => {},
          paste: async () => 0,
          hasFileClipboard: async () => false,
          importDrop: async () => 0,
          openDrop: async () => {},
          close() {},
        },
      })
    }
  })
  await page.goto('/desktop')
  await expect
    .poll(() => page.evaluate(() => typeof (window as RuntimeHost).mountSurface))
    .toBe('function')
  async function open(id: string, query = '') {
    await page.evaluate(
      async ({ id, query }) => {
        const frame = document.createElement('iframe')
        frame.id = id
        frame.style.cssText = 'width:740px;height:620px;border:0;display:inline-block'
        const loaded = new Promise<void>((resolve) => {
          frame.onload = () => resolve()
        })
        frame.src = `/desktop-surface.html${query}`
        document.body.append(frame)
        await loaded
        await (window as RuntimeHost).mountSurface!(frame.contentWindow!)
      },
      { id, query },
    )
    return page.frameLocator(`#${id}`)
  }
  await page.setViewportSize({ width: 1520, height: 900 })
  const first = await open('first'),
    second = await open('second')
  const notesA = first.locator('[data-file-path="Notes"]').first()
  const notesB = second.locator('[data-file-path="Notes"]').first()
  await expect(notesA).toBeVisible()
  await expect(notesB).toBeVisible()
  await notesA.click({ button: 'right' })
  await notesB.click({ button: 'right' })
  const menuA = first.getByRole('menuitem', { name: 'Open in new window', exact: true })
  const menuB = second.getByRole('menuitem', { name: 'Open in new window', exact: true })
  await expect(menuA).toBeVisible()
  await expect(menuB).toBeVisible()
  await menuA.press('Escape')
  await expect(menuA).toBeHidden()
  await expect(menuB).toBeVisible()
  await menuB.press('Escape')
  await notesA.click()
  await expect
    .poll(() =>
      page
        .locator('#first')
        .evaluate((node) => (node as HTMLIFrameElement).contentWindow!.location.search),
    )
    .toContain('dir=Notes')
  await expect(notesB).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('independent-documents.png') })
  await page.evaluate(async () => {
    const frame = document.querySelector<HTMLIFrameElement>('#first')!
    await (window as RuntimeHost).unmountSurface!(frame.contentWindow!)
    if (frame.contentDocument!.getElementById('root')!.childNodes.length)
      throw new Error('Mount survived its lifetime')
    frame.remove()
  })
  await notesB.click()
  await expect
    .poll(() =>
      page
        .locator('#second')
        .evaluate((node) => (node as HTMLIFrameElement).contentWindow!.location.search),
    )
    .toContain('dir=Notes')
  const reopened = await open('reopened', '?mode=viewer&viewing=Images%2Fphoto.png&dir=Images')
  await expect(reopened.locator('img').filter({ visible: true }).first()).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('reopened-image.png') })
  expect(scripts.filter((url) => /\/assets\/index-[^/]+\.js$/.test(url))).toHaveLength(1)
  await page.evaluate(async () => {
    for (const frame of document.querySelectorAll('iframe')) {
      await (window as RuntimeHost).unmountSurface!(frame.contentWindow!)
      frame.remove()
    }
    await (window as RuntimeHost).shutdownRuntime!()
  })
  expect(errors).toEqual([])
})
