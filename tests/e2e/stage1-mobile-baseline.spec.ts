import { expect, test, type Locator, type Page } from '@playwright/test'

const OFFLINE_DATABASE = 'derp-offline-v1'
const OFFLINE_STORE = 'entries'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

async function useListView(page: Page) {
  await page.getByRole('button', { name: 'List view' }).click()
  await expect(page.locator('table')).toBeVisible()
}

async function waitForMetadata(media: Locator) {
  await expect
    .poll(() =>
      media.evaluate(
        (element: HTMLMediaElement) =>
          element.readyState >= HTMLMediaElement.HAVE_METADATA &&
          Number.isFinite(element.duration) &&
          element.duration > 1,
      ),
    )
    .toBe(true)
}

async function expectResumeAt(media: Locator, target: number) {
  await waitForMetadata(media)
  await expect
    .poll(() =>
      media.evaluate((element: HTMLMediaElement) => {
        element.pause()
        return element.currentTime
      }),
    )
    .toBeGreaterThanOrEqual(target - 0.15)
}

test.describe('Stage 1 phone media safety baseline', () => {
  test('browses, resumes, saves, and replays Range-backed video offline', async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000)

    await page.goto('/')
    const mediaRoot = await page.evaluate(async () => {
      await navigator.serviceWorker.ready
      const response = await fetch('/api/auth/config')
      const config = (await response.json()) as { mediaRoots?: Array<{ name: string }> }
      return (config.mediaRoots?.length ?? 0) > 1 ? config.mediaRoots![0].name : ''
    })
    const controlled = await page.evaluate(() => navigator.serviceWorker.controller !== null)
    if (!controlled) await page.reload()
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
      .toBe(true)

    const prefix = mediaRoot ? `${mediaRoot}/` : ''
    const videoDirectory = `${prefix}Videos`
    const videoPath = `${videoDirectory}/sample.mp4`
    const encodedVideoPath = videoPath.split('/').map(encodeURIComponent).join('/')
    const mediaUrl = `/api/media/${encodedVideoPath}`

    await useListView(page)
    if (mediaRoot) {
      await page.locator('table tr').filter({ hasText: mediaRoot }).click()
      await expect(page).toHaveURL(new RegExp(`dir=${encodeURIComponent(mediaRoot)}`))
    }
    await page.locator('table tr').filter({ hasText: 'Videos' }).click()
    await expect(page).toHaveURL(new RegExp(`dir=${encodeURIComponent(videoDirectory)}`))
    await page.locator('table tr').filter({ hasText: 'sample.mp4' }).click()
    await expect(page).toHaveURL(/playing=/)

    const onlineVideo = page.locator('video').first()
    await expect(onlineVideo).toBeVisible()
    await expect(onlineVideo).toHaveAttribute('controls', '')
    await waitForMetadata(onlineVideo)
    const seekTarget = await onlineVideo.evaluate((element: HTMLVideoElement) => {
      element.pause()
      return Math.max(0.5, Math.min(element.duration * 0.4, element.duration - 0.5))
    })
    await onlineVideo.evaluate((element: HTMLVideoElement, target: number) => {
      element.currentTime = target
    }, seekTarget)
    await expect
      .poll(() => onlineVideo.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThanOrEqual(seekTarget - 0.05)
    await onlineVideo.dispatchEvent('timeupdate')

    await page.reload()
    await expectResumeAt(page.locator('video').first(), seekTarget)

    await page.goto(`/?dir=${encodeURIComponent(videoDirectory)}`)
    await useListView(page)
    await page.getByRole('button', { name: 'More actions for sample.mp4', exact: true }).click()
    await page.getByText('Make available offline', { exact: true }).click()
    await expect(page.getByText('sample.mp4 is available offline', { exact: true })).toBeVisible()

    const storedEntry = await page.evaluate(
      async ({ databaseName, storeName, path }) => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(databaseName, 1)
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const result = await new Promise<{ path?: string; mediaUrl?: string } | undefined>(
          (resolve, reject) => {
            const request = database.transaction(storeName).objectStore(storeName).get(path)
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
          },
        )
        database.close()
        return result
      },
      { databaseName: OFFLINE_DATABASE, storeName: OFFLINE_STORE, path: videoPath },
    )
    expect(storedEntry).toMatchObject({ path: videoPath, mediaUrl })

    await context.setOffline(true)
    await page.goto(`/?offline=1&dir=${encodeURIComponent(videoDirectory)}`)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Offline', exact: true })).toBeVisible()

    const range = await page.evaluate(async (url) => {
      const response = await fetch(url, { headers: { Range: 'bytes=0-63' } })
      return {
        status: response.status,
        length: (await response.arrayBuffer()).byteLength,
        acceptRanges: response.headers.get('accept-ranges'),
        contentRange: response.headers.get('content-range'),
      }
    }, mediaUrl)
    expect(range).toEqual({
      status: 206,
      length: 64,
      acceptRanges: 'bytes',
      contentRange: expect.stringMatching(/^bytes 0-63\/\d+$/),
    })

    await useListView(page)
    await page.locator('table tr').filter({ hasText: 'sample.mp4' }).click()
    const offlineVideo = page.locator('video').first()
    await expect(offlineVideo).toBeVisible()
    await expect
      .poll(() => offlineVideo.evaluate((element: HTMLVideoElement) => element.currentSrc))
      .toContain(mediaUrl)
    await expectResumeAt(offlineVideo, seekTarget)
  })
})
