import { expect, test, type Page } from '@playwright/test'
import { READER_PDF } from '../fixtures/generate-media'

async function openSamplePdf(page: Page) {
  await page.context().route('**/api/media/Documents/reader.pdf', async (route) => {
    await route.fulfill({ body: READER_PDF, contentType: 'application/pdf' })
  })
  await page.goto('/?dir=Documents&viewing=Documents%2Freader.pdf')
  await expect(page.getByTestId('pdf-text-layer').first()).toBeVisible()
  await expect(page.getByTestId('reader-page-indicator')).toBeVisible()
  await page.getByTestId('reader-page-indicator').click()
  await page.getByTestId('reader-page-input').fill('1')
  await page.getByTestId('reader-page-input').press('Enter')
  await waitForReaderScrollToSettle(page)
  await expect(page.getByTestId('reader-page-indicator')).toContainText('Page 1 / 4')
  await expect(
    page.getByTestId('pdf-text-layer').filter({ hasText: 'Selectable reader text' }),
  ).toBeVisible()
}

async function waitForReaderScrollToSettle(page: Page) {
  await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('[data-testid="reader-viewport"]')
    if (!viewport) throw new Error('Expected reader viewport')
    return new Promise<void>((resolve) => {
      let previous = viewport.scrollTop
      let stableFrames = 0
      const check = () => {
        const current = viewport.scrollTop
        stableFrames = current === previous ? stableFrames + 1 : 0
        previous = current
        if (stableFrames >= 4) resolve()
        else window.requestAnimationFrame(check)
      }
      window.requestAnimationFrame(check)
    })
  })
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
    .filter({ hasText: firstText })
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

async function selectBookText(page: Page, phrase: string) {
  await page
    .getByTestId('reader-book')
    .getByText(phrase, { exact: false })
    .first()
    .evaluate((element, selectedPhrase) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node && !node.textContent?.includes(selectedPhrase)) node = walker.nextNode()
      if (!node?.textContent) throw new Error('Expected EPUB selection text')
      const start = node.textContent.indexOf(selectedPhrase)
      const range = document.createRange()
      range.setStart(node, start)
      range.setEnd(node, start + selectedPhrase.length)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      const rect = range.getBoundingClientRect()
      element.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          clientX: rect.right,
          clientY: rect.top + rect.height / 2,
        }),
      )
    }, phrase)
}

test.describe('Reader', () => {
  test('opens PDFs directly and restores server-synced position settings', async ({ page }) => {
    await page.goto('/?dir=Documents')
    await page.locator('tr', { hasText: 'sample.pdf' }).click()

    await expect(page.getByTestId('reader-dialog')).toBeVisible()
    await expect(page.getByTestId('pdf-canvas').first()).toBeVisible()
    await expect(page.getByTestId('open-with-reader')).toHaveCount(0)
    await page.getByTestId('reader-settings-button').click()
    await page.getByLabel('Reader zoom in').click()
    await expect(page.getByTestId('reader-settings')).toContainText('110%')
    await page.getByLabel('Close reader').click()

    await page.locator('tr', { hasText: 'sample.pdf' }).click()
    await page.getByTestId('reader-settings-button').click()
    await expect(page.getByTestId('reader-settings')).toContainText('110%')
  })

  test('reads EPUB and FB2 as reflowable books with outlines', async ({ page }) => {
    await page.goto('/?dir=Documents')
    await page.locator('tr', { hasText: 'reader.epub' }).click()
    await expect(page.getByTestId('reader-book')).toContainText('Selectable EPUB text begins here.')
    await expect(page.getByTestId('reader-book').locator('script, form')).toHaveCount(0)
    await expect(page.getByTestId('reader-book').locator('img[src^="http"]')).toHaveCount(0)
    await expect
      .poll(() => page.getByTestId('reader-book').locator('style').textContent())
      .toContain('@font-face')
    await expect
      .poll(() => page.getByTestId('reader-book').locator('style').textContent())
      .toContain('blob:')
    if (!(await page.getByTestId('reader-outline').isVisible())) {
      await page.getByTestId('reader-outline-button').click()
    }
    await page.getByTestId('reader-outline').getByText('Opening', { exact: true }).click()
    await expect(page.getByTestId('reader-book-progress')).toContainText('Opening')
    await expect(page.getByTestId('reader-book-progress')).not.toContainText('Chapter 1')
    await expect(page.getByTestId('reader-book').locator('[aria-label^="Chapter "]')).toHaveCount(0)
    await page.getByRole('button', { name: 'Previous chapter' }).click()
    await expect(page.getByTestId('reader-book-progress')).toContainText('Opening')
    await page.waitForTimeout(350)
    await selectBookText(page, 'Selectable EPUB text')
    await expect(page.getByTestId('reader-selection-menu')).toBeVisible()
    await expect(page.getByTestId('reader-selection-menu')).toContainText('Selectable EPUB text')
    await expect(page.getByRole('button', { name: 'Define', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Translate', exact: true })).toBeVisible()
    if (!(await page.getByTestId('reader-outline').isVisible())) {
      await page.getByTestId('reader-outline-button').click()
    }
    await expect(page.getByTestId('reader-outline')).toContainText('Second chapter')
    await page.getByRole('link', { name: 'Continue internally' }).click()
    await expect(page.getByTestId('reader-book-progress')).toContainText('Second chapter')
    await page.getByRole('button', { name: 'Previous chapter' }).click()
    await expect(page.getByTestId('reader-book-progress')).toContainText('Opening')
    await page.getByLabel('Close reader').click()

    await page
      .locator('tr')
      .filter({ has: page.getByText('reader.fb2', { exact: true }) })
      .click()
    await expect(page.getByTestId('reader-book')).toContainText('Selectable FB2 text begins here.')
    if (!(await page.getByTestId('reader-outline').isVisible())) {
      await page.getByTestId('reader-outline-button').click()
    }
    await expect(page.getByTestId('reader-outline')).toContainText('Nested section')
    await page.getByLabel('Close reader').click()

    await page
      .locator('tr')
      .filter({ has: page.getByText('reader.fb2.zip', { exact: true }) })
      .click()
    await expect(page.getByTestId('reader-book')).toContainText('Selectable FB2 text begins here.')
  })

  test('keeps book settings separate from chapter controls in narrow readers', async ({ page }) => {
    await page.setViewportSize({ width: 500, height: 720 })
    await page.goto('/?dir=Documents&viewing=Documents%2Freader.epub')
    await expect(page.getByTestId('reader-book')).toBeVisible()
    const next = await page.getByRole('button', { name: 'Next chapter' }).boundingBox()
    const settings = await page.getByTestId('reader-settings-button').boundingBox()
    if (!next || !settings) throw new Error('Book toolbar controls not laid out')
    expect(settings.x).toBeGreaterThanOrEqual(next.x + next.width + 3)

    await page.getByTestId('reader-settings-button').click()
    const reader = await page.getByTestId('reader-dialog').boundingBox()
    const menu = await page.getByTestId('reader-settings').boundingBox()
    if (!reader || !menu) throw new Error('Book settings menu not laid out')
    expect(menu.width).toBeGreaterThanOrEqual(380)
    expect(menu.x).toBeGreaterThanOrEqual(reader.x)
    expect(menu.x + menu.width).toBeLessThanOrEqual(reader.x + reader.width)
  })

  test('clamps and immediately persists reader-controlled book appearance', async ({ page }) => {
    await page.goto('/?dir=Documents&viewing=Documents%2Freader.epub')
    const book = page.getByTestId('reader-book')
    await expect(book).toBeVisible()
    await page.getByTestId('reader-settings-button').click()
    await page.getByRole('button', { name: 'dark', exact: true }).click()
    await expect(book).toHaveCSS('background-color', 'rgb(23, 23, 23)')

    const decreases = page.getByRole('button', { name: 'Decrease', exact: true })
    for (let index = 0; index < 12; index += 1) {
      await decreases.nth(0).click()
      await decreases.nth(1).click()
      await decreases.nth(2).click()
    }
    const settings = page.getByTestId('reader-settings')
    await expect(settings).toContainText('50%')
    await expect(settings).toContainText('0.80')
    await expect(settings).toContainText('20rem')
    const chapter = book.locator('[data-book-chapter="chapter-1"]')
    const appearanceBeforeTheme = await chapter.evaluate((element) => {
      const book = element.closest<HTMLElement>('[data-testid="reader-book"]')!
      const style = getComputedStyle(book)
      const chapterStyle = getComputedStyle(element)
      return {
        fontSize: style.fontSize,
        lineHeight: chapterStyle.lineHeight,
        maxWidth: chapterStyle.maxWidth,
      }
    })
    expect(appearanceBeforeTheme).toEqual({
      fontSize: '8px',
      lineHeight: '6.4px',
      maxWidth: '320px',
    })
    await settings.getByRole('button', { name: 'light', exact: true }).click()
    await expect(settings).toContainText('50%')
    await expect(settings).toContainText('0.80')
    await expect(settings).toContainText('20rem')
    await expect
      .poll(() =>
        chapter.evaluate((element) => {
          const book = element.closest<HTMLElement>('[data-testid="reader-book"]')!
          const style = getComputedStyle(book)
          const chapterStyle = getComputedStyle(element)
          return {
            fontSize: style.fontSize,
            lineHeight: chapterStyle.lineHeight,
            maxWidth: chapterStyle.maxWidth,
          }
        }),
      )
      .toEqual(appearanceBeforeTheme)
    await settings.getByRole('button', { name: 'detailed', exact: true }).click()
    await page.getByLabel('Close reader').click()

    await page.locator('tr', { hasText: 'reader.epub' }).click()
    await page.getByTestId('reader-settings-button').click()
    await expect(page.getByRole('button', { name: 'light', exact: true })).toHaveClass(
      /bg-\[#303030\]/,
    )
    await expect(page.getByRole('button', { name: 'detailed', exact: true })).toHaveClass(
      /bg-\[#303030\]/,
    )
    await expect(page.getByTestId('reader-book')).toHaveCSS(
      'background-color',
      'rgb(255, 253, 248)',
    )
    await page.getByRole('button', { name: 'Reset appearance' }).click()
    await page.getByRole('button', { name: 'compact', exact: true }).click()
    await page.getByLabel('Close reader').click()
  })

  test('saves old book position when mounted reader switches files', async ({ page }) => {
    const epubSaves: Array<{ state?: { chapterProgress?: number }; status?: number }> = []
    await page.route('**/api/reader-state', async (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as {
          path?: string
          state?: { chapterProgress?: number }
        }
        if (body.path === 'Documents/reader-switch.epub') {
          const response = await route.fetch()
          epubSaves.push({ ...body, status: response.status() })
          await route.fulfill({ response })
          return
        }
      }
      await route.continue()
    })
    await page.goto('/?dir=Documents&viewing=Documents%2Freader-switch.epub')
    await expect(page.getByTestId('reader-book')).toBeVisible()
    if (!(await page.getByTestId('reader-outline').isVisible())) {
      await page.getByTestId('reader-outline-button').click()
    }
    await page.getByTestId('reader-outline').getByText('Opening', { exact: true }).click()
    await waitForReaderScrollToSettle(page)
    const viewport = page.getByTestId('reader-viewport')
    await expect
      .poll(() =>
        viewport.evaluate((element) => {
          const chapter = element.querySelector<HTMLElement>('[data-book-chapter="chapter-1"]')!
          const viewportTop = element.getBoundingClientRect().top
          const chapterRect = chapter.getBoundingClientRect()
          const progress = (viewportTop - chapterRect.top) / Math.max(1, chapterRect.height)
          if (progress <= 0.1) element.scrollTop += 300
          return progress
        }),
      )
      .toBeGreaterThan(0.1)
    const savedTop = await viewport.evaluate((element) => element.scrollTop)
    await page.getByTestId('reader-dialog').evaluate((element) => {
      element.setAttribute('data-reader-instance', 'old')
      history.pushState(null, '', '/?dir=Documents&viewing=Documents%2Freader.fb2')
    })
    await expect(page.getByTestId('reader-book')).toContainText('Selectable FB2 text begins here.')
    await expect(page.getByTestId('reader-dialog')).not.toHaveAttribute(
      'data-reader-instance',
      'old',
    )
    await expect.poll(() => epubSaves.at(-1)?.state?.chapterProgress ?? 0).toBeGreaterThan(0.1)
    await expect.poll(() => epubSaves.at(-1)?.status ?? 0).toBe(200)
    await expect
      .poll(async () => {
        const response = await page.request.get(
          '/api/reader-state?path=Documents%2Freader-switch.epub',
        )
        const body = (await response.json()) as { state?: { chapterProgress?: number } }
        return body.state?.chapterProgress ?? 0
      })
      .toBeGreaterThan(0.1)

    await page.evaluate(() => {
      history.pushState(null, '', '/?dir=Documents&viewing=Documents%2Freader-switch.epub')
    })
    await expect(page.getByTestId('reader-book-progress')).toContainText('Opening')
    await expect
      .poll(() => viewport.evaluate((element) => element.scrollTop))
      .toBeCloseTo(savedTop, -1)
  })

  test('restores exact EPUB position inside a chapter', async ({ page }) => {
    await page.goto('/?dir=Documents&viewing=Documents%2Freader-position.epub')
    await expect(page.getByTestId('reader-book')).toBeVisible()
    if (!(await page.getByTestId('reader-outline').isVisible())) {
      await page.getByTestId('reader-outline-button').click()
    }
    await page.getByTestId('reader-outline').getByText('Opening', { exact: true }).click()
    const viewport = page.getByTestId('reader-viewport')
    await page.waitForTimeout(350)
    await viewport.evaluate((element) => {
      element.scrollTop += 300
    })
    await page.waitForTimeout(50)
    const savedTop = await viewport.evaluate((element) => element.scrollTop)
    expect(savedTop).toBeGreaterThan(250)
    const geometry = await viewport.evaluate((element) => {
      const chapter = element.querySelector('[data-book-chapter="chapter-1"]')!
      const viewportRect = element.getBoundingClientRect()
      const chapterRect = chapter.getBoundingClientRect()
      return {
        viewportTop: viewportRect.top,
        chapterTop: chapterRect.top,
        chapterHeight: chapterRect.height,
      }
    })
    expect(geometry.chapterHeight).toBeLessThan(10_000)
    await page.getByLabel('Close reader').click()
    await expect(page.getByTestId('reader-dialog')).toBeHidden()
    const storedResponse = await page.request.get(
      '/api/reader-state?path=Documents%2Freader-position.epub',
    )
    const stored = (await storedResponse.json()) as {
      state?: { chapterId?: string; chapterProgress?: number; scrollTop?: number }
    }
    expect(stored.state?.chapterId).toBe('chapter-1')
    expect(stored.state?.chapterProgress).toBeGreaterThan(0.1)

    await page.locator('tr', { hasText: 'reader-position.epub' }).click()
    await expect(page.getByTestId('reader-book-progress')).toContainText('Opening')
    await expect
      .poll(() => viewport.evaluate((element) => element.scrollTop))
      .toBeCloseTo(savedTop, -1)
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

  test('keeps fit-width PDF placeholders at rendered size while scrolling', async ({ page }) => {
    await openSamplePdf(page)
    await page.getByTestId('reader-settings-button').click()
    await page.getByRole('button', { name: 'width', exact: true }).click()

    await expect
      .poll(() =>
        page
          .getByTestId('pdf-canvas')
          .first()
          .evaluate((canvas) => canvas.getBoundingClientRect().width),
      )
      .toBeGreaterThan(900)

    await page.getByTestId('reader-viewport').evaluate((viewport) => {
      viewport.scrollTop = viewport.scrollHeight
      viewport.dispatchEvent(new Event('scroll', { bubbles: true }))
    })

    const widths = await page
      .getByTestId('pdf-canvas')
      .evaluateAll((canvases) => canvases.map((canvas) => canvas.getBoundingClientRect().width))
    expect(widths).toHaveLength(4)
    expect(Math.max(...widths) - Math.min(...widths), JSON.stringify(widths)).toBeLessThan(2)
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
    await waitForReaderScrollToSettle(page)

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
    const archivedSessions: string[] = []
    await page.route('**/api/hermes/capabilities', async (route) => {
      await route.fulfill({ json: { compatible: true, readerAi: true } })
    })
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
      const body = route.request().postDataJSON() as { sessionId?: string }
      if (body.sessionId) archivedSessions.push(body.sessionId)
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
          durable_session_id: 'reader-e2e-1-rotated',
          previous_durable_session_id: 'reader-e2e-1',
          type: 'message.complete',
          payload: { text: '**Meaning:** definition result' },
        },
      })
    })
    await expect(page.getByTestId('reader-ai-result').locator('.cm-md-strong')).toHaveText(
      'Meaning:',
    )
    await expect.poll(() => archivedSessions).toContain('reader-e2e-1-rotated')

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
    await page.route('**/api/hermes/capabilities', async (route) => {
      await route.fulfill({ json: { compatible: true, readerAi: true } })
    })
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
    await page.getByTestId('reader-settings-button').click()
    await page.getByRole('button', { name: 'define', exact: true }).click()
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
