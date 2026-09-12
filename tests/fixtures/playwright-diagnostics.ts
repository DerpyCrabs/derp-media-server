import {
  test as base,
  expect,
  type BrowserContext,
  type ConsoleMessage,
  type Page,
} from 'playwright/test'

export * from 'playwright/test'

export const test = base.extend<{ browserDiagnostics: void }>({
  browserDiagnostics: [
    async ({ browser }, use, testInfo) => {
      const diagnostics: string[] = []
      const tracked = new Set<BrowserContext>()
      const cleanups: (() => void)[] = []
      const trackPage = (page: Page) => {
        const onError = (error: Error) =>
          diagnostics.push(error.stack || error.message || String(error))
        const onConsole = (message: ConsoleMessage) => {
          if (
            (message.type() === 'warning' || message.type() === 'error') &&
            /\[[A-Z][A-Z_]+\]/.test(message.text())
          )
            diagnostics.push(message.text())
        }
        page.on('pageerror', onError)
        page.on('console', onConsole)
        cleanups.push(() => {
          page.off('pageerror', onError)
          page.off('console', onConsole)
        })
      }
      const trackContext = async (context: BrowserContext) => {
        if (tracked.has(context)) return
        tracked.add(context)
        await context.addInitScript(() => {
          window.addEventListener('error', (event) => {
            console.error('[BROWSER_WINDOW_ERROR]', event.message)
          })
        })
        context.pages().forEach(trackPage)
        context.on('page', trackPage)
        cleanups.push(() => context.off('page', trackPage))
      }
      const original = browser.newContext.bind(browser)
      browser.newContext = async (...args) => {
        const context = await original(...args)
        await trackContext(context)
        return context
      }
      await Promise.all(browser.contexts().map(trackContext))
      try {
        await use()
      } finally {
        browser.newContext = original
        cleanups.forEach((cleanup) => cleanup())
        if (diagnostics.length) {
          await testInfo.attach('browser-diagnostics', {
            body: JSON.stringify(diagnostics, null, 2),
            contentType: 'application/json',
          })
        }
        expect(diagnostics, diagnostics.join('\n')).toEqual([])
      }
    },
    { auto: true },
  ],
})
