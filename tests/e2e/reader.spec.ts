import { expect, test, type Page } from '@playwright/test'
import { READER_PDF } from '../fixtures/generate-media'

test.use({ serviceWorkers: 'block' })

async function openSamplePdf(page: Page) {
  await page.context().route('**/api/media/Documents/reader.pdf', async (route) => {
    await route.fulfill({ body: READER_PDF, contentType: 'application/pdf' })
  })
  await page.goto('/?dir=Documents&viewing=Documents%2Freader.pdf')
  await expect(page.getByTestId('pdf-text-layer').first()).toBeVisible()
}

async function disableAutomaticSelectionAction(page: Page) {
  await page.getByTestId('reader-settings-button').click()
  await page.getByRole('button', { name: 'none', exact: true }).click()
}

async function chooseReaderFromOpenWith(page: Page) {
  await page.getByTestId('open-with-menu').click()
  await expect(page.getByTestId('open-with-submenu')).toBeVisible()
  await page.getByTestId('open-with-reader').click()
}

async function selectPdfLines(page: Page, firstText: string, lastText = firstText) {
  await page
    .getByTestId('pdf-text-layer')
    .first()
    .evaluate(
      (layer, phrases) => {
        const spans = [...layer.querySelectorAll('span')]
        const first = spans.find((span) => span.textContent?.includes(phrases.firstText))
        const last = spans.find((span) => span.textContent?.includes(phrases.lastText))
        if (!first?.firstChild || !last?.firstChild) throw new Error('Expected PDF selection spans')
        const range = document.createRange()
        range.setStart(first.firstChild, 0)
        range.setEnd(last.firstChild, last.textContent?.length ?? 0)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
        const rect = last.getBoundingClientRect()
        last.dispatchEvent(
          new PointerEvent('pointerup', {
            bubbles: true,
            clientX: rect.right - 2,
            clientY: rect.top + rect.height / 2,
          }),
        )
      },
      { firstText, lastText },
    )
}

test.describe('Reader', () => {
  test('opens PDFs from file context menu and restores position settings', async ({ page }) => {
    await page.goto('/?dir=Documents')
    await page.locator('tr', { hasText: 'sample.pdf' }).click({ button: 'right' })
    await expect(page.getByTestId('open-with-menu')).toHaveText(/Open with/)
    await chooseReaderFromOpenWith(page)

    await expect(page.getByTestId('reader-dialog')).toBeVisible()
    await expect(page.getByTestId('pdf-canvas').first()).toBeVisible()
    await expect(page.getByTestId('open-with-reader')).toHaveCount(0)
    await page.getByTestId('reader-settings-button').click()
    await page.getByLabel('Reader zoom in').click()
    await expect(page.getByTestId('reader-settings')).toContainText('110%')
    await page.getByLabel('Close reader').click()

    await page.locator('tr', { hasText: 'sample.pdf' }).click({ button: 'right' })
    await chooseReaderFromOpenWith(page)
    await page.getByTestId('reader-settings-button').click()
    await expect(page.getByTestId('reader-settings')).toContainText('110%')
  })

  test('opens image folders in natural order', async ({ page }) => {
    await page.goto('/')
    await page.locator('tr', { hasText: 'Images' }).click({ button: 'right' })
    await page.getByTestId('open-with-menu').click()
    await expect(page.getByTestId('open-with-browser')).toBeVisible()
    await expect(page.getByTestId('open-with-reader')).toBeVisible()
    await page.getByTestId('open-with-browser').click()
    await expect(page).toHaveURL(/dir=Images/)
    await expect(page.getByTestId('reader-dialog')).toHaveCount(0)

    await page.goto('/')
    await page.locator('tr', { hasText: 'Images' }).click({ button: 'right' })
    await chooseReaderFromOpenWith(page)

    await expect(page.getByTestId('reader-dialog')).toBeVisible()
    await expect(page.getByTestId('reader-image-page')).toHaveCount(2)
    await expect(page.getByTestId('reader-page-indicator')).not.toContainText('/ 0')
    await expect(page.getByTestId('region-layer').first()).toHaveCSS('pointer-events', 'auto')

    await page.getByTestId('reader-settings-button').click()
    await page.getByRole('button', { name: 'page', exact: true }).click()
    await page.keyboard.press('End')
    await expect(page.getByTestId('reader-page-indicator')).toContainText('Page 2 / 2')
    await page.getByLabel('Close reader').click()

    await page.locator('tr', { hasText: 'Images' }).click({ button: 'right' })
    await chooseReaderFromOpenWith(page)
    await expect(page.getByTestId('reader-page-indicator')).toContainText('Page 2 / 2')
  })

  test('selects PDF text and opens reader actions', async ({ page }) => {
    await openSamplePdf(page)
    await disableAutomaticSelectionAction(page)
    await selectPdfLines(page, 'Selectable reader text')

    await expect(page.getByTestId('reader-selection-menu')).toBeVisible()
    await expect(page.getByTestId('reader-translate')).toBeVisible()
    await expect(page.getByTestId('reader-define')).toBeVisible()
  })

  test('matches derp-reader toolbar and natural PDF scale', async ({ page }) => {
    await openSamplePdf(page)

    await expect(page.getByTestId('reader-dialog').locator('header')).not.toContainText(
      'reader.pdf',
    )
    await expect(page.getByTestId('reader-dialog').locator('.page-label')).toHaveCount(0)
    const geometry = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>('[data-testid="reader-dialog"] header')
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="pdf-canvas"]')
      if (!header || !canvas) throw new Error('Reader geometry missing')
      return {
        headerHeight: header.getBoundingClientRect().height,
        canvasWidth: canvas.getBoundingClientRect().width,
      }
    })
    expect(geometry.headerHeight).toBe(39)
    expect(geometry.canvasWidth).toBeCloseTo(612, 0)
    await expect(page.locator('[title="Download"]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Next page' })).toHaveCount(0)
  })

  test('fullscreens reader instead of whole application', async ({ page }) => {
    await openSamplePdf(page)
    await page.evaluate(() => {
      const reader = document.querySelector<HTMLElement>('[data-testid="reader-dialog"]')
      if (!reader) throw new Error('Reader missing')
      ;(window as unknown as { __fullscreenTarget?: Element }).__fullscreenTarget = undefined
      reader.requestFullscreen = async function () {
        ;(window as unknown as { __fullscreenTarget?: Element }).__fullscreenTarget = this
      }
      document.documentElement.requestFullscreen = async function () {
        ;(window as unknown as { __fullscreenTarget?: Element }).__fullscreenTarget = this
      }
    })
    await page.getByRole('button', { name: 'Enter fullscreen' }).click()
    const targetsReader = await page.evaluate(
      () =>
        (window as unknown as { __fullscreenTarget?: Element }).__fullscreenTarget ===
        document.querySelector('[data-testid="reader-dialog"]'),
    )
    expect(targetsReader).toBe(true)
  })

  test('ports page jump and exact reading-position restore', async ({ page }) => {
    await openSamplePdf(page)
    await page.getByTestId('reader-page-indicator').click()
    await page.getByTestId('reader-page-input').fill('3')
    await page.getByTestId('reader-page-input').press('Enter')
    await expect(page.getByTestId('reader-page-indicator')).toContainText('Page 3 / 4')
    await expect
      .poll(() => page.getByTestId('reader-viewport').evaluate((viewport) => viewport.scrollTop))
      .toBeGreaterThan(1_000)

    const savedTop = await page.getByTestId('reader-viewport').evaluate((viewport) => {
      viewport.scrollTop += 137
      viewport.dispatchEvent(new Event('scroll', { bubbles: true }))
      return viewport.scrollTop
    })
    await page.getByLabel('Close reader').click()
    await page.goto('/?dir=Documents&viewing=Documents%2Freader.pdf')
    await expect(page.getByTestId('pdf-canvas').first()).toBeVisible()
    await expect
      .poll(() => page.getByTestId('reader-viewport').evaluate((viewport) => viewport.scrollTop))
      .toBeCloseTo(savedTop, 0)
    await expect(page.getByTestId('reader-page-indicator')).toContainText('Page 3 / 4')
  })

  test('keeps multi-line selection menu outside selection and inside reader', async ({ page }) => {
    await openSamplePdf(page)
    await disableAutomaticSelectionAction(page)
    await selectPdfLines(page, 'Selectable reader text', 'Fourth selected line')
    await expect(page.getByTestId('reader-selection-menu')).toBeVisible()
    await expect(page.getByRole('textbox')).toContainText(
      /Selectable reader text.*Fourth selected line/,
    )

    const geometry = await page.evaluate(() => {
      const menu = document.querySelector<HTMLElement>('[data-testid="reader-selection-menu"]')
      const reader = document.querySelector<HTMLElement>('[data-testid="reader-viewport"]')
      const selection = window.getSelection()
      if (!menu || !reader || !selection?.rangeCount) throw new Error('Selection geometry missing')
      const menuRect = menu.getBoundingClientRect()
      const readerRect = reader.getBoundingClientRect()
      const selectionRect = selection.getRangeAt(0).getBoundingClientRect()
      return {
        inside: menuRect.top >= readerRect.top && menuRect.bottom <= readerRect.bottom,
        overlaps:
          menuRect.left < selectionRect.right &&
          menuRect.right > selectionRect.left &&
          menuRect.top < selectionRect.bottom &&
          menuRect.bottom > selectionRect.top,
      }
    })
    expect(geometry.inside).toBe(true)
    expect(geometry.overlaps).toBe(false)
  })

  test('keeps selection context while reader scrolls and native range clears', async ({ page }) => {
    await openSamplePdf(page)
    await disableAutomaticSelectionAction(page)
    await selectPdfLines(page, 'Selectable reader text')
    await expect(page.getByTestId('reader-selection-menu')).toBeVisible()

    await page.evaluate(() => window.getSelection()?.removeAllRanges())
    await page.getByTestId('reader-viewport').evaluate((viewport) => {
      viewport.scrollTop += 80
      viewport.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    await expect(page.getByTestId('reader-selection-menu')).toBeVisible()
    await expect(page.getByRole('textbox')).toContainText('Selectable reader text')
  })

  test('ports settings and selection-menu dismissal behavior', async ({ page }) => {
    await openSamplePdf(page)
    await page.getByTestId('reader-settings-button').click()
    await expect(page.getByTestId('reader-settings')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('reader-settings')).toHaveCount(0)

    await disableAutomaticSelectionAction(page)
    await selectPdfLines(page, 'Selectable reader text')
    const menu = page.getByTestId('reader-selection-menu')
    await expect(menu).toBeVisible()
    await page.getByRole('textbox').click()
    await expect(menu).toBeVisible()
    await page.getByTestId('reader-viewport').click({ position: { x: 12, y: 12 } })
    await expect(menu).toHaveCount(0)
  })

  test('ports PDF image-region selection mode without notes or chat actions', async ({ page }) => {
    await openSamplePdf(page)
    await page.getByTestId('reader-settings-button').click()
    await page.getByRole('button', { name: 'image', exact: true }).click()
    await page.getByTestId('reader-settings-button').click()
    await page.getByRole('button', { name: 'none', exact: true }).click()

    const region = page.getByTestId('region-layer').first()
    await region.dragTo(region, {
      sourcePosition: { x: 80, y: 90 },
      targetPosition: { x: 240, y: 180 },
    })
    await expect(page.getByTestId('reader-selection-menu')).toBeVisible()
    await expect(region.locator('.reader-region-box')).toBeVisible()
    await expect(page.getByRole('textbox')).toHaveCount(0)
    await expect(page.getByTestId('reader-selection-menu')).not.toContainText('Note')
    await expect(page.getByTestId('reader-selection-menu')).not.toContainText('chat')
  })

  test('ports Define Markdown and plain Translate selection actions', async ({ page }) => {
    let turnRequests = 0
    await page.addInitScript(() => {
      class MockEventSource {
        static latest: MockEventSource | undefined
        onmessage: ((event: MessageEvent<string>) => void) | null = null
        onerror: (() => void) | null = null

        constructor() {
          MockEventSource.latest = this
        }

        close() {}
      }
      Object.defineProperty(window, 'EventSource', { configurable: true, value: MockEventSource })
      const target = window as typeof window & { __emitReaderAi?: (payload: unknown) => void }
      target.__emitReaderAi = (payload) =>
        MockEventSource.latest?.onmessage?.(
          new MessageEvent('message', { data: JSON.stringify(payload) }),
        )
    })
    await page.route('**/api/hermes/turn', async (route) => {
      turnRequests += 1
      await route.fulfill({ json: { sessionId: `reader-e2e-${turnRequests}` } })
    })
    await page.route('**/api/hermes/archive', async (route) => {
      await route.fulfill({ json: { archived: true } })
    })

    await openSamplePdf(page)
    await disableAutomaticSelectionAction(page)
    await selectPdfLines(page, 'Selectable reader text')
    await page.getByTestId('reader-define').click()
    await expect.poll(() => turnRequests).toBe(1)
    await page.evaluate(() => {
      const target = window as typeof window & { __emitReaderAi?: (payload: unknown) => void }
      target.__emitReaderAi?.({
        params: {
          durable_session_id: 'reader-e2e-1',
          type: 'message.complete',
          payload: { text: '**Meaning:** definition result' },
        },
      })
    })
    await expect(page.getByTestId('reader-ai-result').locator('.cm-md-strong')).toHaveText(
      'Meaning:',
    )

    await page.getByTestId('reader-translate').click()
    await expect.poll(() => turnRequests).toBe(2)
    await page.evaluate(() => {
      const target = window as typeof window & { __emitReaderAi?: (payload: unknown) => void }
      target.__emitReaderAi?.({
        params: {
          durable_session_id: 'reader-e2e-2',
          type: 'message.complete',
          payload: { text: 'Plain translation result' },
        },
      })
    })
    await expect(page.getByTestId('reader-ai-result')).toHaveText('Plain translation result')
    await expect(page.getByTestId('reader-ai-result').locator('p')).toHaveCount(0)
  })

  test('ignores stale AI output when selection changes during a request', async ({ page }) => {
    let turnRequests = 0
    await page.addInitScript(() => {
      class MockEventSource {
        static instances: MockEventSource[] = []
        onmessage: ((event: MessageEvent<string>) => void) | null = null
        onerror: (() => void) | null = null

        constructor() {
          MockEventSource.instances.push(this)
        }

        close() {}
      }
      Object.defineProperty(window, 'EventSource', { configurable: true, value: MockEventSource })
      const target = window as typeof window & {
        __emitReaderAiAt?: (index: number, payload: unknown) => void
      }
      target.__emitReaderAiAt = (index, payload) =>
        MockEventSource.instances[index]?.onmessage?.(
          new MessageEvent('message', { data: JSON.stringify(payload) }),
        )
    })
    await page.route('**/api/hermes/turn', async (route) => {
      turnRequests += 1
      await route.fulfill({ json: { sessionId: `reader-stale-${turnRequests}` } })
    })
    await page.route('**/api/hermes/archive', async (route) => {
      await route.fulfill({ json: { archived: true } })
    })

    await openSamplePdf(page)
    await selectPdfLines(page, 'Selectable reader text')
    await expect.poll(() => turnRequests).toBe(1)
    await selectPdfLines(page, 'Second selected line')
    await expect.poll(() => turnRequests).toBe(2)

    await page.evaluate(() => {
      const target = window as typeof window & {
        __emitReaderAiAt?: (index: number, payload: unknown) => void
      }
      target.__emitReaderAiAt?.(0, {
        params: {
          durable_session_id: 'reader-stale-1',
          type: 'message.complete',
          payload: { text: 'stale definition' },
        },
      })
    })
    await expect(page.getByTestId('reader-selection-menu')).not.toContainText('stale definition')

    await page.evaluate(() => {
      const target = window as typeof window & {
        __emitReaderAiAt?: (index: number, payload: unknown) => void
      }
      target.__emitReaderAiAt?.(1, {
        params: {
          durable_session_id: 'reader-stale-2',
          type: 'message.complete',
          payload: { text: 'fresh definition' },
        },
      })
    })
    await expect(page.getByTestId('reader-ai-result')).toHaveText('fresh definition')
  })
})
