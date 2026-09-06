import { test, expect } from '@playwright/test'

for (const viewport of [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`without Media AI config the ${viewport.name} root keeps the original toolbar and search`, async ({
    page,
  }) => {
    test.setTimeout(45000)
    await page.setViewportSize(viewport)
    const aiRequests: string[] = []
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (path.startsWith('/api/media-ai/') && path !== '/api/media-ai/status')
        aiRequests.push(path)
    })
    const status = page.waitForResponse('**/api/media-ai/status')
    await page.goto('/')
    expect(await (await status).json()).toMatchObject({ enabled: false })
    await expect(page.locator('table')).toBeVisible()
    await expect(page.getByTestId('media-navigation-header')).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'Media center' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'For you', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Library', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Refresh recommendations' })).toHaveCount(0)
    await expect(page.getByTestId('for-you')).toHaveCount(0)
    const search = page.getByTestId('classic-file-search-trigger')
    await expect(search).toBeVisible()
    await expect(page.getByRole('button', { name: 'Search library', exact: true })).toHaveCount(1)
    const searchBounds = await search.boundingBox()
    const settingsBounds = await page
      .getByRole('button', { name: 'Open theme settings' })
      .boundingBox()
    expect(searchBounds!.y).toBeLessThan(56)
    expect(searchBounds!.y).toBe(settingsBounds!.y)
    expect(searchBounds!.x + searchBounds!.width).toBeLessThanOrEqual(settingsBounds!.x)
    expect((await page.getByTestId('media-chrome-pad-root').boundingBox())!.y).toBe(0)
    expect(new URL(page.url()).search).toBe('')

    await expect
      .poll(
        async () => {
          const response = await page.request.get('/api/files/search?q=Videos&limit=20')
          const result = (await response.json()) as { results: { path: string }[] }
          return result.results.some((item) => item.path === 'Videos')
        },
        { timeout: 30000 },
      )
      .toBe(true)
    await search.click()
    const palette = page.getByTestId('file-search-palette')
    await expect(palette.getByRole('combobox')).toBeFocused()
    await palette.getByRole('combobox').fill('Videos')
    await palette.getByRole('option').filter({ hasText: 'Videos' }).first().click()
    await expect(palette).toHaveCount(0)
    await expect(page.locator('table').getByText('sample.mp4', { exact: true })).toBeVisible()
    expect(new URL(page.url()).searchParams.get('dir')).toBe('Videos')
    expect(new URL(page.url()).searchParams.has('view')).toBe(false)
    await expect(page.getByTestId('media-navigation-header')).toHaveCount(0)
    await expect(search).toBeVisible()
    expect(aiRequests).toEqual([])
  })
}
