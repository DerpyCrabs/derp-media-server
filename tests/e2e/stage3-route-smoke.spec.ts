import { expect, test } from '@playwright/test'

const routes = [
  { path: '/', ready: '[data-testid="file-browser"]' },
  { path: '/workspace', ready: '[data-window-group]' },
  { path: '/canvas', ready: '[data-testid="canvas-name-trigger"]' },
] as const

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'narrow phone', width: 390, height: 844 },
] as const) {
  test(`direct routes stay clean on ${viewport.name}`, async ({ context, baseURL }) => {
    for (const route of routes) {
      const page = await context.newPage()
      await page.setViewportSize(viewport)
      const consoleErrors: string[] = []
      const pageErrors: string[] = []
      const failedRequests: string[] = []
      const errorResponses: string[] = []
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text())
      })
      page.on('pageerror', (error) => pageErrors.push(error.message))
      page.on('requestfailed', (request) => {
        failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`)
      })
      page.on('response', (response) => {
        if (response.status() >= 400) {
          errorResponses.push(
            `${response.status()} ${response.request().method()} ${response.url()}`,
          )
        }
      })

      const response = await page.goto(route.path)
      expect(response?.ok(), `${route.path} document response`).toBe(true)
      await expect(page.locator(route.ready).first()).toBeVisible()
      await page.waitForTimeout(100)
      expect(consoleErrors, `${route.path} console errors at ${baseURL}`).toEqual([])
      expect(pageErrors, `${route.path} page errors`).toEqual([])
      expect(failedRequests, `${route.path} failed requests`).toEqual([])
      expect(errorResponses, `${route.path} HTTP errors`).toEqual([])
      await page.close()
    }
  })
}
