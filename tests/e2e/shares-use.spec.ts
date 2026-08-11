import { test, expect, Page } from '@playwright/test'
import path from 'path'

const sessionFile = process.env.BATCH_ID ? `session-${process.env.BATCH_ID}.json` : 'session.json'
const authStoragePath = path.resolve(__dirname, '../fixtures/.auth', sessionFile)
const minimalPngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='

let fileShareUrl: string
let folderShareUrl: string
let editableShareUrl: string

async function createShare(page: Page, body: Record<string, unknown>): Promise<string> {
  const res = await page.request.post('/api/shares', { data: body })
  const json = await res.json()
  const base = `/share/${json.share.token}`
  return json.share.passcode ? `${base}?p=${encodeURIComponent(json.share.passcode)}` : base
}

function watchShareRequests(page: Page) {
  const requests: string[] = []
  page.context().on('request', (request) => {
    requests.push(request.url())
  })
  return requests
}

function watchConsole(page: Page) {
  const lines: string[] = []
  page.on('console', (msg) => lines.push(msg.text()))
  return lines
}

function sawShareSseConnect(consoleLines: string[]) {
  return consoleLines.some((l) => l.includes('[Share SSE] Connected to share stream'))
}

function getShareToken(shareUrl: string): string {
  return new URL(shareUrl, 'http://localhost').pathname.split('/')[2]
}

function expectNoAdminRoutes(requests: string[]) {
  const forbiddenAdminPaths = new Set([
    '/api/auth/config',
    '/api/settings',
    '/api/stats/views',
    '/api/shares',
    '/api/files',
    '/api/events/stream',
  ])

  const adminLeaks = requests.filter((url) => {
    const pathname = new URL(url).pathname
    return (
      forbiddenAdminPaths.has(pathname) ||
      pathname.startsWith('/api/files/') ||
      pathname.startsWith('/api/media/')
    )
  })
  expect(adminLeaks).toEqual([])
}

function expectNoAdminShareLeaks(requests: string[]) {
  expectNoAdminRoutes(requests)

  const unscopedLeaks = requests.filter((url) => {
    if (!url.includes('/api/share/')) return false
    return (
      url.includes('SharedContent%2F') ||
      url.includes('/SharedContent/') ||
      url.includes('dir=SharedContent') ||
      url.includes('path=SharedContent')
    )
  })
  expect(unscopedLeaks).toEqual([])
}

async function deleteShareAndFixtures(page: Page, token: string, fixturePaths: string[]) {
  if (token) {
    await page.request.post('/api/shares/delete', { data: { token } }).catch(() => {})
  }
  for (const fixturePath of fixturePaths) {
    await page.request.post('/api/files/delete', { data: { path: fixturePath } }).catch(() => {})
  }
}

test.describe('Using Shares', () => {
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: authStoragePath })
    const page = await context.newPage()
    fileShareUrl = await createShare(page, {
      path: 'Documents/readme.txt',
      isDirectory: false,
    })
    folderShareUrl = await createShare(page, {
      path: 'SharedContent',
      isDirectory: true,
    })
    editableShareUrl = await createShare(page, {
      path: 'SharedContent',
      isDirectory: true,
      editable: true,
      restrictions: {
        allowUpload: true,
        allowEdit: true,
        allowDelete: true,
      },
    })
    await page.close()
    await context.close()
  })

  test('views a shared text file page', async ({ page }) => {
    await page.goto(fileShareUrl)
    await expect(page.getByText('readme.txt')).toBeVisible()
    await expect(page.getByText('TXT File')).toBeVisible()
  })

  test('single-file Markdown share pastes and renders an image through token routes', async ({
    page,
  }, testInfo) => {
    const unique = `${testInfo.workerIndex}-${Date.now()}`
    const markdownPath = `SharedContent/share-markdown-${unique}.md`
    const unreferencedPath = `SharedContent/images/unreferenced-${unique}.png`
    const fixturePaths = [markdownPath, unreferencedPath]
    let token = ''

    try {
      const createFileResponse = await page.request.post('/api/files/create', {
        data: {
          type: 'file',
          path: markdownPath,
          content: '# Shared Markdown\n\nPaste image here.\n',
        },
      })
      expect(createFileResponse.ok()).toBe(true)
      const createUnreferencedResponse = await page.request.post('/api/files/create', {
        data: {
          type: 'file',
          path: unreferencedPath,
          base64Content: minimalPngBase64,
        },
      })
      expect(createUnreferencedResponse.ok()).toBe(true)

      const shareUrl = await createShare(page, { path: markdownPath, isDirectory: false })
      token = getShareToken(shareUrl)
      const editableResponse = await page.request.put('/api/shares', {
        data: {
          token,
          editable: true,
          restrictions: { allowUpload: true, allowEdit: true, allowDelete: true },
        },
      })
      expect(editableResponse.ok()).toBe(true)

      const requests = watchShareRequests(page)
      await page.goto(shareUrl)

      const editDocument = page.locator('[data-testid="markdown-document"][data-mode="edit"]')
      const editor = editDocument.getByRole('textbox')
      await expect(editor).toBeVisible()
      await expect(editDocument.locator('.cm-editor')).toBeVisible()
      await expect(page.locator('textarea')).toHaveCount(0)

      await editor.focus()
      await page.keyboard.press('Control+a')
      const uploadResponsePromise = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/api/share/${token}/upload-image` &&
          response.request().method() === 'POST',
      )
      const saveResponsePromise = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/api/share/${token}/edit` &&
          response.request().method() === 'POST',
      )

      await editor.evaluate((element, pngBase64) => {
        const bytes = Uint8Array.from(atob(pngBase64), (character) => character.charCodeAt(0))
        const transfer = new DataTransfer()
        transfer.items.add(new File([bytes], 'clipboard.png', { type: 'image/png' }))
        element.dispatchEvent(
          new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: transfer,
          }),
        )
      }, minimalPngBase64)

      const uploadResponse = await uploadResponsePromise
      expect(uploadResponse.ok()).toBe(true)
      const uploaded = (await uploadResponse.json()) as { path: string; fileName: string }
      fixturePaths.push(uploaded.path)
      const inserted = `![[images/${uploaded.fileName}]]`
      await expect(editDocument.locator('.cm-md-image-source')).toHaveText(inserted)
      const uploadedMediaPath = uploaded.path.split('/').map(encodeURIComponent).join('/')
      const unsavedImagePreview = await page.request.get(
        `/api/share/${token}/media/${uploadedMediaPath}`,
      )
      expect(unsavedImagePreview.ok()).toBe(true)

      const readOnlyButton = page.getByRole('button', { name: 'Read only' })
      await readOnlyButton.focus()
      const saveResponse = await saveResponsePromise
      expect(saveResponse.ok(), await saveResponse.text()).toBe(true)
      expect(saveResponse.request().postDataJSON()).toMatchObject({ path: '.', content: inserted })

      const mediaResponsePromise = page.waitForResponse((response) => {
        const pathname = new URL(response.url()).pathname
        return (
          pathname.startsWith(`/api/share/${token}/media/`) &&
          pathname.endsWith(`/images/${encodeURIComponent(uploaded.fileName)}`)
        )
      })
      await readOnlyButton.click()

      const readDocument = page.locator('[data-testid="markdown-document"][data-mode="read"]')
      const image = readDocument.locator('img.cm-md-image')
      await expect(image).toBeVisible()
      await expect(image).toHaveAttribute('src', new RegExp(`/api/share/${token}/media/`))
      expect((await mediaResponsePromise).ok()).toBe(true)

      const unreferencedMediaPath = unreferencedPath.split('/').map(encodeURIComponent).join('/')
      const guessedImage = await page.request.get(
        `/api/share/${token}/media/${unreferencedMediaPath}`,
      )
      expect(guessedImage.status()).toBe(403)

      const removeReference = await page.request.post(`/api/share/${token}/edit`, {
        data: { path: '.', content: '# Image removed\n' },
      })
      expect(removeReference.ok()).toBe(true)
      const removedImage = await page.request.get(`/api/share/${token}/media/${uploadedMediaPath}`)
      expect(removedImage.status()).toBe(403)

      const requestPaths = requests.map((url) => new URL(url).pathname)
      expect(requestPaths).toContain(`/api/share/${token}/upload-image`)
      expect(requestPaths).toContain(`/api/share/${token}/edit`)
      expect(
        requestPaths.some((pathname) => pathname.startsWith(`/api/share/${token}/media/`)),
      ).toBe(true)
      expectNoAdminRoutes(requests)
    } finally {
      await deleteShareAndFixtures(page, token, fixturePaths)
    }
  })

  test('base64 share edit does not settle previews from unused text content', async ({
    page,
  }, testInfo) => {
    const unique = `${testInfo.workerIndex}-${Date.now()}`
    const markdownPath = `SharedContent/share-binary-edit-${unique}.md`
    const fixturePaths = [markdownPath]
    let token = ''

    try {
      const createFileResponse = await page.request.post('/api/files/create', {
        data: { type: 'file', path: markdownPath, content: '# Original\n' },
      })
      expect(createFileResponse.ok()).toBe(true)

      const shareUrl = await createShare(page, { path: markdownPath, isDirectory: false })
      token = getShareToken(shareUrl)
      const editableResponse = await page.request.put('/api/shares', {
        data: {
          token,
          editable: true,
          restrictions: { allowUpload: true, allowEdit: true, allowDelete: true },
        },
      })
      expect(editableResponse.ok()).toBe(true)
      await page.goto(shareUrl)
      await expect(page.locator('[data-testid="markdown-document"]')).toBeVisible()

      const uploadResponse = await page.request.post(`/api/share/${token}/upload-image`, {
        data: {
          base64Content: minimalPngBase64,
          mimeType: 'image/png',
          fileName: `binary-edit-${unique}.png`,
        },
      })
      const uploadBody = await uploadResponse.text()
      expect(uploadResponse.ok(), uploadBody).toBe(true)
      const uploaded = JSON.parse(uploadBody) as {
        path: string
        rollbackId: string
      }
      fixturePaths.push(uploaded.path)

      const finalizeResponse = await page.request.post(
        `/api/share/${token}/finalize-image-upload`,
        { data: { rollbackId: uploaded.rollbackId } },
      )
      expect(finalizeResponse.ok()).toBe(true)

      const uploadedMediaPath = uploaded.path.split('/').map(encodeURIComponent).join('/')
      expect((await page.request.get(`/api/share/${token}/media/${uploadedMediaPath}`)).ok()).toBe(
        true,
      )

      const editResponse = await page.request.post(`/api/share/${token}/edit`, {
        data: {
          path: '.',
          base64Content: Buffer.from('# Binary replacement\n').toString('base64'),
          content: '# Unused text without image\n',
        },
      })
      expect(editResponse.ok()).toBe(true)
      expect((await page.request.get(`/api/share/${token}/media/${uploadedMediaPath}`)).ok()).toBe(
        true,
      )
    } finally {
      await deleteShareAndFixtures(page, token, fixturePaths)
    }
  })

  test('nested knowledge-base directory share resolves root image attachments', async ({
    page,
  }, testInfo) => {
    const unique = `${testInfo.workerIndex}-${Date.now()}`
    const fileName = `nested-share-${unique}.md`
    const imageName = `nested-image-${unique}.png`
    const markdownPath = `Notes/projects/${fileName}`
    const imagePath = `Notes/images/${imageName}`
    const collisionPath = `Notes/projects/Notes/images/${imageName}`
    let token = ''

    try {
      const createFileResponse = await page.request.post('/api/files/create', {
        data: {
          type: 'file',
          path: markdownPath,
          content: `# Nested share\n\n![[${imageName}]]\n`,
        },
      })
      expect(createFileResponse.ok()).toBe(true)
      const imageResponse = await page.request.post('/api/files/create', {
        data: { type: 'file', path: imagePath, base64Content: minimalPngBase64 },
      })
      expect(imageResponse.ok()).toBe(true)
      const collisionResponse = await page.request.post('/api/files/create', {
        data: { type: 'file', path: collisionPath, content: 'not the KB image' },
      })
      expect(collisionResponse.ok()).toBe(true)

      const shareUrl = await createShare(page, {
        path: 'Notes/projects',
        isDirectory: true,
      })
      token = getShareToken(shareUrl)
      await page.goto(shareUrl)
      await expect(page.locator('table').getByText(fileName, { exact: true })).toBeVisible()

      const relativeCollision = await page.request.get(
        `/api/share/${token}/media/Notes/images/${imageName}`,
      )
      expect(relativeCollision.ok()).toBe(true)
      expect(await relativeCollision.text()).toBe('not the KB image')

      const imageResponsePromise = page.waitForResponse((response) => {
        const pathname = new URL(response.url()).pathname
        return pathname === `/api/share/${token}/knowledge-base-image/Notes/images/${imageName}`
      })
      await page.locator('table').getByText(fileName, { exact: true }).click()

      const document = page.locator('[data-testid="markdown-document"][data-mode="read"]')
      await expect(document.locator(`img.cm-md-image[alt="${imageName}"]`)).toBeVisible()
      expect((await imageResponsePromise).ok()).toBe(true)
    } finally {
      await deleteShareAndFixtures(page, token, [markdownPath, imagePath, collisionPath])
    }
  })

  test('shared file page shows download button', async ({ page }) => {
    await page.goto(fileShareUrl)
    await expect(
      page.getByRole('button', { name: /Download/i }).or(page.locator('a:has-text("Download")')),
    ).toBeVisible()
  })

  test('browses a shared folder', async ({ page }) => {
    const requests = watchShareRequests(page)

    await page.goto(folderShareUrl)
    await expect(page.getByText('public-doc.txt')).toBeVisible()
    await expect(page.getByText('subfolder')).toBeVisible()
    expectNoAdminShareLeaks(requests)
  })

  test('share interactions stay scoped to share APIs', async ({ page }) => {
    const requests = watchShareRequests(page)
    const consoleLines = watchConsole(page)
    const token = getShareToken(folderShareUrl)

    await page.goto(folderShareUrl)
    await expect(page.getByText('public-doc.txt')).toBeVisible()

    await page.getByText('public-doc.txt').click()
    await expect(page.getByText('public document for share testing')).toBeVisible()
    await page.getByRole('button', { name: 'Close' }).click()

    await page.getByText('subfolder').first().click()
    await page.waitForURL(/dir=subfolder/)
    await expect(page.getByText('nested.txt')).toBeVisible()

    await page.getByRole('button', { name: 'SharedContent' }).click()
    await expect(page.getByText('public-video.mp4')).toBeVisible()

    await page.getByText('public-video.mp4').click()
    await expect(page.locator('video')).toBeVisible()

    expect(
      requests.some((url) => new URL(url).pathname === `/api/share/${token}/stream`) ||
        sawShareSseConnect(consoleLines),
    ).toBeTruthy()
    expectNoAdminShareLeaks(requests)
  })

  test('share receives live updates through scoped stream', async ({ page }) => {
    const requests = watchShareRequests(page)
    const consoleLines = watchConsole(page)
    const token = getShareToken(editableShareUrl)
    const liveFileName = `live-share-update-${Date.now()}.txt`

    await page.goto(editableShareUrl)
    await expect(page.getByText('public-doc.txt')).toBeVisible()
    await expect.poll(() => sawShareSseConnect(consoleLines)).toBe(true)

    const createResponse = await page.request.post(`/api/share/${token}/create`, {
      data: {
        type: 'file',
        path: liveFileName,
        content: 'live update',
      },
    })
    expect(createResponse.ok()).toBeTruthy()

    await expect(page.locator('table').getByText(liveFileName)).toBeVisible()
    expect(
      requests.some((url) => new URL(url).pathname === `/api/share/${token}/stream`) ||
        sawShareSseConnect(consoleLines),
    ).toBeTruthy()
    expectNoAdminShareLeaks(requests)

    const deleteResponse = await page.request.post(`/api/share/${token}/delete`, {
      data: { path: liveFileName },
    })
    expect(deleteResponse.ok()).toBeTruthy()
    await expect(page.locator('table').getByText(liveFileName)).not.toBeVisible()
  })

  test('navigates into subfolder within shared folder', async ({ page }) => {
    await page.goto(folderShareUrl)
    await page.getByText('subfolder').first().click()
    await page.waitForURL(/dir=subfolder/)
    await expect(page.getByText('nested.txt')).toBeVisible()
  })

  test('uses breadcrumbs to navigate within share', async ({ page }) => {
    const sep = folderShareUrl.includes('?') ? '&' : '?'
    await page.goto(`${folderShareUrl}${sep}dir=subfolder`)
    await expect(page.getByText('nested.txt')).toBeVisible()
    await page.getByRole('button', { name: 'SharedContent' }).click()
    await expect(page.getByText('public-doc.txt')).toBeVisible()
  })

  test('share folder breadcrumb context menu offers download and workspace', async ({ page }) => {
    const sep = folderShareUrl.includes('?') ? '&' : '?'
    await page.goto(`${folderShareUrl}${sep}dir=subfolder`)
    const root = page.locator('[data-testid="share-file-browser"]')
    await root.locator('[data-breadcrumb-path="subfolder"]').click({ button: 'right' })
    await expect(page.getByTestId('breadcrumb-menu-download-zip')).toBeVisible()
    await expect(page.getByTestId('breadcrumb-menu-open-workspace')).toBeVisible()
  })

  test('plays video in shared folder', async ({ page }) => {
    await page.goto(folderShareUrl)
    await page.getByText('public-video.mp4').click()
    await expect(page.locator('video')).toBeVisible()
  })

  test('Grant players ignore owner legacy resume positions', async ({ page }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('grant-resume-seeded')) {
        localStorage.setItem(
          'video-playback-times',
          JSON.stringify({
            state: {
              playbackTimes: {
                'SharedContent/public-video.mp4': 0.75,
                'SharedContent/track.mp3': 0.65,
              },
            },
            version: 0,
          }),
        )
        sessionStorage.setItem('grant-resume-seeded', '1')
      }
      HTMLMediaElement.prototype.play = () => Promise.resolve()
    })

    await page.goto(folderShareUrl)
    await page.getByText('public-video.mp4', { exact: true }).click()
    const video = page.locator('video').first()
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState >= 2))
      .toBe(true)
    expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeLessThan(
      0.2,
    )

    await page.getByRole('button', { name: 'Close player' }).click()
    await page.getByText('track.mp3', { exact: true }).click()
    const audio = page.locator('audio').first()
    await expect
      .poll(() => audio.evaluate((element: HTMLAudioElement) => element.readyState >= 2))
      .toBe(true)
    expect(await audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeLessThan(
      0.2,
    )
  })

  test('Grant progress never enters owner Continue history', async ({ page }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('owner-resume-seeded')) {
        localStorage.setItem(
          'video-playback-times',
          JSON.stringify({
            state: { playbackTimes: { 'Videos/sample.mp4': 0.5 } },
            version: 0,
          }),
        )
        sessionStorage.setItem('owner-resume-seeded', '1')
      }
      HTMLMediaElement.prototype.play = () => Promise.resolve()
    })

    await page.goto(folderShareUrl)
    await page.getByText('public-video.mp4', { exact: true }).click()
    const video = page.locator('video').first()
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState >= 2))
      .toBe(true)
    await video.evaluate((element: HTMLVideoElement) => {
      element.currentTime = 0.8
      element.dispatchEvent(new Event('timeupdate'))
      element.dispatchEvent(new Event('pause'))
    })

    await page.getByRole('button', { name: 'Close player' }).click()
    await page.getByText('track.mp3', { exact: true }).click()
    const audio = page.locator('audio').first()
    await expect
      .poll(() => audio.evaluate((element: HTMLAudioElement) => element.readyState >= 2))
      .toBe(true)
    await audio.evaluate((element: HTMLAudioElement) => {
      element.currentTime = 0.8
      element.dispatchEvent(new Event('timeupdate'))
      element.dispatchEvent(new Event('pause'))
    })

    const playbackTimes = await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('video-playback-times') ?? '{}') as {
        state?: { playbackTimes?: Record<string, number> }
      }
      return saved.state?.playbackTimes ?? {}
    })
    expect(playbackTimes).toEqual({ 'Videos/sample.mp4': 0.5 })

    await page.goto('/home')
    const continueSection = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Continue', exact: true }),
    })
    await expect(continueSection.getByText('sample.mp4', { exact: true })).toBeVisible()
    await expect(continueSection.getByText('public-video.mp4', { exact: true })).toHaveCount(0)
    await expect(continueSection.getByText('track.mp3', { exact: true })).toHaveCount(0)
  })

  test('views text file in shared folder', async ({ page }) => {
    await page.goto(folderShareUrl)
    await page.getByText('public-doc.txt').click()
    await expect(page.getByText('public document for share testing')).toBeVisible()
  })

  test('edits a file in editable share', async ({ page }) => {
    await page.goto(editableShareUrl)
    await page.locator('table').getByText('public-doc.txt').click()
    const textarea = page.locator('textarea')
    const closeButton = page.locator('button[title="Close"]')
    await expect(textarea).toBeVisible()

    await textarea.fill('Edited via share.\n')
    await Promise.all([
      page.waitForResponse(
        (resp) =>
          resp.url().includes('/api/share/') &&
          resp.url().endsWith('/edit') &&
          resp.status() === 200,
      ),
      closeButton.focus(),
    ])

    // Close and reopen to verify persistence
    await closeButton.click()
    await expect(page.locator('[role="dialog"]')).not.toBeVisible()
    await page.locator('table').getByText('public-doc.txt').click()
    await expect(page.locator('textarea')).toBeVisible()
    const content = await page.locator('textarea').inputValue()
    expect(content).toContain('Edited via share')

    // Restore original content
    await page.locator('textarea').fill('This is a public document for share testing.\n')
    await Promise.all([
      page.waitForResponse(
        (resp) =>
          resp.url().includes('/api/share/') &&
          resp.url().endsWith('/edit') &&
          resp.status() === 200,
      ),
      closeButton.focus(),
    ])
    await closeButton.click()
  })

  test('creates a file in editable share', async ({ page }) => {
    await page.goto(editableShareUrl)
    await page.locator('button[title="Create new file"]').click()
    const dialog = page.getByRole('dialog', { name: /create.*file/i })
    const nameInput = dialog.getByRole('textbox')
    await nameInput.clear()
    await nameInput.fill('share-created.txt')
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/share/') && r.url().includes('/create') && r.status() === 200,
      ),
      nameInput.press('Enter'),
    ])
    await expect(page.locator('table').getByText('share-created.txt')).toBeVisible()
  })

  test('creates a folder in editable share', async ({ page }, testInfo) => {
    const token = getShareToken(editableShareUrl)
    const suffix = `${testInfo.workerIndex}-${Date.now()}`
    const folderName = `share-folder-${suffix}`
    const refreshFileName = `dialog-refresh-${suffix}.txt`
    const consoleLines = watchConsole(page)

    await page.goto(editableShareUrl)
    await expect.poll(() => sawShareSseConnect(consoleLines)).toBe(true)
    await page.locator('button[title="Create new folder"]').click()
    const dialog = page.getByRole('dialog', { name: /create.*folder/i })
    const nameInput = dialog.locator('input[placeholder="Folder name"]')
    await nameInput.fill(folderName)

    // Live share updates must not remount the browser and discard an open dialog.
    const infoRefresh = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/share/${token}/info` &&
        response.status() === 200,
    )
    const refreshResponse = await page.request.post(`/api/share/${token}/create`, {
      data: { type: 'file', path: refreshFileName, content: 'refresh' },
    })
    expect(refreshResponse.ok()).toBeTruthy()
    await infoRefresh
    await expect(dialog).toBeVisible()
    await expect(nameInput).toHaveValue(folderName)

    const createResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/share/${token}/create` &&
        response.request().postDataJSON().path === folderName &&
        response.status() === 200,
    )
    await Promise.all([createResponse, nameInput.press('Enter')])
    await expect(page.locator('table').getByText(folderName, { exact: true })).toBeVisible()

    const deleteResponse = await page.request.post(`/api/share/${token}/delete`, {
      data: { path: refreshFileName },
    })
    expect(deleteResponse.ok()).toBeTruthy()
  })

  test('deletes a file in editable share', async ({ page }) => {
    await page.goto(editableShareUrl)
    await expect(page.locator('table').getByText('share-created.txt')).toBeVisible()

    await page
      .locator('table tr')
      .filter({ hasText: 'share-created.txt' })
      .click({ button: 'right' })
    await page.locator('[data-slot="context-menu-item"]').getByText('Delete').click()
    await page.getByRole('button', { name: /Delete/i }).click()

    await expect(page.locator('table').getByText('share-created.txt')).not.toBeVisible()
  })

  test('non-editable share hides edit controls', async ({ page }) => {
    await page.goto(folderShareUrl)
    await expect(page.locator('button[title="Create new file"]')).not.toBeVisible()
    await expect(page.locator('button[title="Create new folder"]')).not.toBeVisible()

    await page.locator('table').getByText('public-doc.txt').click()
    await expect(page.locator('[role="dialog"]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).not.toBeVisible()
  })
})
