import { expect, test } from '@playwright/test'

test.describe('Known playback regressions', () => {
  test('media responses require revalidation before reuse', async ({ request }) => {
    const response = await request.get('/api/media/Music/track.mp3')
    const headers = response.headers()
    const validator = headers.etag ?? headers['last-modified']

    expect(headers['cache-control']).toContain('no-cache')
    expect(validator).toBeTruthy()

    const revalidated = await request.get('/api/media/Music/track.mp3', {
      headers: { 'If-None-Match': validator! },
    })
    expect(revalidated.status()).toBe(304)
  })
})
