import { expect, test } from '@playwright/test'

test.describe('Offline mode', () => {
  test('generates image and video thumbnails locally without thumbnail APIs', async ({ page, context }) => {
    test.setTimeout(60_000)
    await page.goto('/')
    const root = await page.evaluate(async () => {
      await navigator.serviceWorker.ready
      const config = (await fetch('/api/auth/config').then((response) => response.json())) as {
        mediaRoots?: Array<{ name: string }>
      }
      return (config.mediaRoots?.length ?? 0) > 1 ? config.mediaRoots![0].name : ''
    })
    await page.reload()
    await page.route(/\/api\/(?:share\/[^/]+\/)?thumbnail\//, (route) => route.abort())
    const prefix = root ? `${root}/` : ''

    for (const [directory, name] of [['Images', 'photo.jpg'], ['Videos', 'sample.mp4']] as const) {
      await page.goto(`/?dir=${encodeURIComponent(`${prefix}${directory}`)}`)
      await page.locator('table tr').filter({ hasText: name }).click({ button: 'right' })
      await page.getByText('Make available offline', { exact: true }).click()
      await expect(page.getByText(`${name} is available offline`, { exact: true })).toBeVisible()
    }

    const stored = await page.evaluate(async (paths) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('derp-offline-v1', 1)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      return Promise.all(paths.map((path) => new Promise<{ thumbnailSize: number; mediaSize: number }>((resolve, reject) => {
        const request = db.transaction('entries').objectStore('entries').get(path)
        request.onsuccess = async () => {
          const entry = request.result as { thumbnailBlob?: Blob; blob?: Blob; fileName?: string }
          let mediaSize = entry.blob?.size ?? 0
          if (!mediaSize && entry.fileName) {
            const root = await navigator.storage.getDirectory()
            mediaSize = (await (await root.getFileHandle(entry.fileName)).getFile()).size
          }
          resolve({ thumbnailSize: entry.thumbnailBlob?.size ?? 0, mediaSize })
        }
        request.onerror = () => reject(request.error)
      })))
    }, [`${prefix}Images/photo.jpg`, `${prefix}Videos/sample.mp4`])
    expect(stored.every((entry) => entry.thumbnailSize > 0)).toBe(true)
    expect(stored.every((entry) => entry.mediaSize > 0)).toBe(true)

    await context.setOffline(true)
    for (const directory of ['Images', 'Videos']) {
      await page.goto(`/?offline=1&dir=${encodeURIComponent(`${prefix}${directory}`)}`)
      await page.locator('button:has(.lucide-layout-grid)').click()
      const thumbnail = page.locator('[data-testid$="-thumbnail"]')
      await expect(thumbnail).toBeVisible()
      await expect.poll(() => thumbnail.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
      if (directory === 'Images') {
        await thumbnail.locator('xpath=ancestor::*[@role="button"][1]').click({ button: 'right' })
        await page.getByText('Remove from offline', { exact: true }).click()
        await expect(thumbnail).not.toBeVisible()
      }
    }
    const removed = await page.evaluate(async (path) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('derp-offline-v1', 1)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      return new Promise<boolean>((resolve, reject) => {
        const request = db.transaction('entries').objectStore('entries').get(path)
        request.onsuccess = () => resolve(request.result === undefined)
        request.onerror = () => reject(request.error)
      })
    }, `${prefix}Images/photo.jpg`)
    expect(removed).toBe(true)
  })

  test('directory remains browsable and files open after network loss and reload', async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000)
    await page.goto('/')
    const mediaRoot = await page.evaluate(async () => {
      const response = await fetch('/api/auth/config')
      const config = (await response.json()) as { mediaRoots?: Array<{ name: string }> }
      return (config.mediaRoots?.length ?? 0) > 1 ? config.mediaRoots![0].name : ''
    })
    const controlled = await page.evaluate(async () => {
      await navigator.serviceWorker.ready
      return navigator.serviceWorker.controller !== null
    })
    if (!controlled) await page.reload()
    await page.waitForLoadState('domcontentloaded')
    if (mediaRoot) await page.goto(`/?dir=${encodeURIComponent(mediaRoot)}`)

    const documentsRow = page.locator('table tr').filter({ hasText: 'Documents' })
    await documentsRow.click({ button: 'right' })
    await page.getByText('Make available offline', { exact: true }).click()
    await expect(page.getByText('Documents is available offline', { exact: true })).toBeVisible({
      timeout: 30_000,
    })
    const logicalPrefix = mediaRoot ? `${mediaRoot}/` : ''

    await page.goto(`/?dir=${encodeURIComponent(`${logicalPrefix}Documents`)}`)
    await context.setOffline(true)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Offline', exact: true })).toBeVisible()
    await expect(page.locator('table tr').filter({ hasText: 'readme.txt' })).toBeVisible()

    await context.setOffline(false)
    await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.locator('table tr').filter({ hasText: 'readme.txt' })).toBeVisible()

    await context.setOffline(true)

    await page.goto('/?offline=1')
    if (mediaRoot) {
      await expect(page.locator('table tr').filter({ hasText: mediaRoot })).toBeVisible()
    } else {
      await expect(page.locator('table tr').filter({ hasText: 'Documents' })).toBeVisible()
    }

    await page.reload()
    await expect(page.getByRole('button', { name: 'Offline', exact: true })).toBeVisible()
    if (mediaRoot) await page.locator('table tr').filter({ hasText: mediaRoot }).click()
    await page.locator('table tr').filter({ hasText: 'Documents' }).click()
    await expect(page.locator('table tr').filter({ hasText: 'readme.txt' })).toBeVisible()
    await page.locator('table tr').filter({ hasText: 'readme.txt' }).click()
    await expect(page.getByText('This is a test readme file')).toBeVisible()
    const rangeResult = await page.evaluate(async (path) => {
      const response = await fetch(
        `/api/media/${path.split('/').map(encodeURIComponent).join('/')}`,
        {
          headers: { Range: 'bytes=0-9' },
        },
      )
      return { status: response.status, length: (await response.arrayBuffer()).byteLength }
    }, `${logicalPrefix}Documents/readme.txt`)
    expect(rangeResult).toEqual({ status: 206, length: 10 })

    await page.goto(`/?offline=1&dir=${encodeURIComponent(`${logicalPrefix}Documents`)}`)
    await page.locator('table tr').filter({ hasText: 'résumé 日本.txt' }).click()
    await expect(page.getByText('Unicode offline content')).toBeVisible()

    await page.goto(`/?offline=1&dir=${encodeURIComponent(`${logicalPrefix}Documents`)}`)
    await page.locator('table tr').filter({ hasText: 'sample.pdf' }).click()
    await expect(page.locator('embed[type="application/pdf"]')).toBeVisible()

    await page.goto('/?offline=1')
    if (mediaRoot) await page.locator('table tr').filter({ hasText: mediaRoot }).click()
    const savedDocumentsRow = page.locator('table tr').filter({ hasText: 'Documents' })
    await savedDocumentsRow.click({ button: 'right' })
    await page.getByText('Remove from offline', { exact: true }).click()
    await expect(page.locator('table tr').filter({ hasText: 'Documents' })).not.toBeVisible()

    await context.setOffline(false)
    await page.goto(mediaRoot ? `/?dir=${encodeURIComponent(mediaRoot)}` : '/')
    await expect(page.locator('table').getByText('Documents', { exact: true })).toBeVisible()
  })

  test('share content is saved through token-scoped APIs and opens offline', async ({
    page,
    context,
  }) => {
    test.setTimeout(45_000)
    await page.goto('/')
    const setup = await page.evaluate(async () => {
      await navigator.serviceWorker.ready
      const config = (await fetch('/api/auth/config').then((response) => response.json())) as {
        mediaRoots?: Array<{ name: string }>
      }
      return { root: (config.mediaRoots?.length ?? 0) > 1 ? config.mediaRoots![0].name : '' }
    })
    await page.reload()
    const sharePath = setup.root ? `${setup.root}/SharedContent` : 'SharedContent'
    const created = await page.request.post('/api/shares', {
      data: { path: sharePath, isDirectory: true },
    })
    const body = (await created.json()) as { share: { token: string; passcode?: string } }
    const shareUrl = `/share/${body.share.token}${body.share.passcode ? `?p=${encodeURIComponent(body.share.passcode)}` : ''}`
    await page.goto(shareUrl)

    const row = page.locator('table tr').filter({ hasText: 'public-doc.txt' })
    await row.click({ button: 'right' })
    await page.getByText('Make available offline', { exact: true }).click()
    await expect(
      page.getByText('public-doc.txt is available offline', { exact: true }),
    ).toBeVisible()

    await context.setOffline(true)
    await page.goto('/?offline=1')
    if (setup.root) await page.locator('table tr').filter({ hasText: setup.root }).click()
    await page.locator('table tr').filter({ hasText: 'SharedContent' }).click()
    await page.locator('table tr').filter({ hasText: 'public-doc.txt' }).click()
    await expect(page.getByText('This is a public document for share testing')).toBeVisible()
  })

  test('failed download is reported and leaves no partial offline entry', async ({ page }) => {
    await page.goto('/')
    const root = await page.evaluate(async () => {
      const config = (await fetch('/api/auth/config').then((response) => response.json())) as {
        mediaRoots?: Array<{ name: string }>
      }
      return (config.mediaRoots?.length ?? 0) > 1 ? config.mediaRoots![0].name : ''
    })
    await page.goto(`/?dir=${encodeURIComponent(root ? `${root}/Documents` : 'Documents')}`)
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready
    })
    await page.reload()
    const row = page.locator('table tr').filter({ hasText: 'readme.txt' })
    await row.click({ button: 'right' })
    await page.evaluate(() => {
      const onlineFetch = window.fetch
      window.fetch = ((input, init) =>
        String(input).includes('/api/media/')
          ? Promise.reject(new TypeError('Simulated network loss'))
          : onlineFetch(input, init)) as typeof window.fetch
    })
    await page.getByText('Make available offline', { exact: true }).click()
    await expect(page.getByText("Couldn't save readme.txt", { exact: true })).toBeVisible()

    await page.goto('/?offline=1')
    await expect(page.getByText('readme.txt', { exact: true })).not.toBeVisible()
  })

  test('storage quota failure is reported and leaves no catalog or OPFS residue', async ({ page }) => {
    await page.goto('/')
    const root = await page.evaluate(async () => {
      await navigator.serviceWorker.ready
      const config = (await fetch('/api/auth/config').then((response) => response.json())) as {
        mediaRoots?: Array<{ name: string }>
      }
      return (config.mediaRoots?.length ?? 0) > 1 ? config.mediaRoots![0].name : ''
    })
    await page.reload()
    await page.goto(`/?dir=${encodeURIComponent(root ? `${root}/Documents` : 'Documents')}`)
    const opfsBefore = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory()
      const names: string[] = []
      for await (const name of root.keys()) names.push(name)
      return names.sort()
    })
    await page.evaluate(() => {
      IDBObjectStore.prototype.put = (() => {
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
      }) as typeof IDBObjectStore.prototype.put
    })
    await page.locator('table tr').filter({ hasText: 'readme.txt' }).click({ button: 'right' })
    await page.getByText('Make available offline', { exact: true }).click()
    await expect(page.getByText("Couldn't save readme.txt", { exact: true })).toBeVisible()
    const savedPaths = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('derp-offline-v1', 1)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      return new Promise<string[]>((resolve, reject) => {
        const request = db.transaction('entries').objectStore('entries').getAllKeys()
        request.onsuccess = () => resolve(request.result.map(String))
        request.onerror = () => reject(request.error)
      })
    })
    expect(savedPaths).not.toContain(`${root ? `${root}/` : ''}Documents/readme.txt`)
    const opfsAfter = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory()
      const names: string[] = []
      for await (const name of root.keys()) names.push(name)
      return names.sort()
    })
    expect(opfsAfter).toEqual(opfsBefore)
  })

  test('saved audio and video players open after an offline reload', async ({ page, context }) => {
    test.setTimeout(60_000)
    await page.goto('/')
    const root = await page.evaluate(async () => {
      await navigator.serviceWorker.ready
      const config = (await fetch('/api/auth/config').then((response) => response.json())) as {
        mediaRoots?: Array<{ name: string }>
      }
      return (config.mediaRoots?.length ?? 0) > 1 ? config.mediaRoots![0].name : ''
    })
    await page.reload()
    const prefix = root ? `${root}/` : ''

    await page.goto(`/?dir=${encodeURIComponent(`${prefix}Videos`)}`)
    await page.locator('table tr').filter({ hasText: 'sample.mp4' }).click({ button: 'right' })
    await page.getByText('Make available offline', { exact: true }).click()
    await expect(page.getByText('sample.mp4 is available offline', { exact: true })).toBeVisible()

    await page.goto(`/?dir=${encodeURIComponent(`${prefix}Music`)}`)
    await page.locator('table tr').filter({ hasText: 'track.mp3' }).click({ button: 'right' })
    await page.getByText('Make available offline', { exact: true }).click()
    await expect(page.getByText('track.mp3 is available offline', { exact: true })).toBeVisible()

    await context.setOffline(true)
    await page.goto(`/?offline=1&dir=${encodeURIComponent(`${prefix}Videos`)}`)
    await page.locator('button:has(.lucide-layout-grid)').click()
    await expect(page.locator('[data-testid=file-browser-video-thumbnail]')).toBeVisible()
    await expect
      .poll(() =>
        page
          .locator('[data-testid=file-browser-video-thumbnail]')
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(0)
    await page.reload()
    await expect(page.locator('.file-browser-grid')).toBeVisible()
    await page.locator('button:has(.lucide-list)').click()
    await page.locator('table tr').filter({ hasText: 'sample.mp4' }).click()
    await expect(page.locator('video')).toBeVisible()

    await page.goto(`/?offline=1&dir=${encodeURIComponent(`${prefix}Music`)}`)
    await page.locator('table tr').filter({ hasText: 'track.mp3' }).click()
    await expect(page.locator('audio')).toBeAttached()
  })
})
