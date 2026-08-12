import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test'

const OWNER_PLAYBACK_KEY = 'derp-playback-session-owner-v1'

function uniqueId(prefix: string, testInfo: TestInfo) {
  return [
    prefix,
    process.env.BATCH_ID ?? 'local',
    testInfo.workerIndex,
    Date.now(),
    Math.random().toString(36).slice(2, 8),
  ].join('-')
}

function spacePath(id: string, presentation?: 'focus' | 'tiled' | 'map') {
  const base = `/spaces/id/~${encodeURIComponent(id)}`
  return presentation ? `${base}/${presentation}` : base
}

function browserPane(title: string, dir = '') {
  return {
    kind: 'browser',
    state: {
      title,
      source: { kind: 'local', rootPath: null },
      initialState: { dir },
      iconName: null,
      iconPath: dir,
      iconType: 'folder',
      iconIsVirtual: false,
      tabGroupId: null,
    },
  }
}

async function createPresentationSpace(
  request: APIRequestContext,
  id: string,
  name = 'Stage 7 desk',
) {
  const created = await request.post('/api/spaces/commands', {
    data: {
      command: {
        type: 'create',
        id,
        name,
        origin: 'workspace',
        panes: {
          'pane-library': browserPane('Library pane'),
          'pane-notes': browserPane('Notes pane', 'Notes'),
        },
        arrangements: {
          tiled: {
            placements: {
              'pane-library': { layout: {} },
              'pane-notes': { layout: {} },
            },
            paneOrder: ['pane-library', 'pane-notes'],
            tabGroups: {
              'pane-library': ['pane-library'],
              'pane-notes': ['pane-notes'],
            },
          },
          spatial: {
            placements: {
              'pane-library': {
                bounds: { x: 0, y: 0, width: 640, height: 480 },
                zIndex: 1,
              },
              'pane-notes': {
                bounds: { x: 700, y: 80, width: 640, height: 480 },
                zIndex: 2,
              },
            },
          },
        },
      },
    },
  })
  expect(created.ok()).toBe(true)
}

async function createContentContinuitySpace(
  request: APIRequestContext,
  id: string,
  editorPath: string,
) {
  const editorCreated = await request.post('/api/files/create', {
    data: { path: editorPath, content: '# Stage 7 draft\n\nOriginal text.\n' },
  })
  expect(editorCreated.ok()).toBe(true)
  const panes = {
    editor: {
      kind: 'viewer',
      state: {
        title: 'Stage 7 editor',
        source: { kind: 'local' },
        initialState: { viewing: editorPath, dir: 'Notes' },
        viewerId: 'text-viewer',
        tabGroupId: null,
      },
    },
    reader: {
      kind: 'viewer',
      state: {
        title: 'Stage 7 reader',
        source: { kind: 'local' },
        initialState: {
          viewing: 'Documents/reader.pdf',
          dir: 'Documents',
          readerKind: 'pdf',
        },
        viewerId: 'pdf-reader',
        tabGroupId: null,
      },
    },
    assistant: {
      kind: 'assistant',
      state: {
        title: 'Stage 7 assistant',
        source: { kind: 'local' },
        initialState: {},
        hermes: { draftId: `${id}-draft`, cwd: 'Notes' },
        tabGroupId: null,
      },
    },
  }
  const created = await request.post('/api/spaces/commands', {
    data: {
      command: {
        type: 'create',
        id,
        name: 'Content continuity desk',
        origin: 'workspace',
        panes,
        arrangements: {
          tiled: {
            placements: {
              editor: { layout: {} },
              reader: { layout: {} },
              assistant: { layout: {} },
            },
            paneOrder: ['editor', 'reader', 'assistant'],
            tabGroups: { editor: ['editor'], reader: ['reader'], assistant: ['assistant'] },
          },
          spatial: {
            placements: {
              editor: { bounds: { x: 0, y: 0, width: 680, height: 520 }, zIndex: 1 },
              reader: { bounds: { x: 720, y: 0, width: 680, height: 520 }, zIndex: 2 },
              assistant: { bounds: { x: 360, y: 560, width: 680, height: 520 }, zIndex: 3 },
            },
          },
        },
      },
    },
  })
  expect(created.ok()).toBe(true)
}

async function deleteIfLive(request: APIRequestContext, id: string) {
  const loaded = await request.get(`/api/spaces/by-id/~${encodeURIComponent(id)}`)
  if (!loaded.ok()) return
  const body = (await loaded.json()) as { space: { revision: number; deletedAt?: number } }
  if (body.space.deletedAt !== undefined) return
  await request.post('/api/spaces/commands', {
    data: {
      spaceId: id,
      expectedRevision: body.space.revision,
      command: { type: 'delete' },
    },
  })
}

async function choosePresentation(page: Page, presentation: 'focus' | 'tiled' | 'map') {
  await page
    .getByRole('navigation', { name: 'Space presentation' })
    .getByRole('link', { name: presentation, exact: true })
    .click()
  await expect(page).toHaveURL(new RegExp(`/${presentation}$`))
  const marker =
    presentation === 'focus'
      ? page.getByTestId('space-focus')
      : presentation === 'map'
        ? page.getByTestId('infinite-canvas')
        : page.getByTestId('workspace-window-visible-content').first()
  await expect(marker).toBeVisible()
}

test('bare Space route uses Focus on phone and keeps video playback through Pane changes', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(60_000)
  const id = uniqueId('stage7-phone-focus', testInfo)
  await createPresentationSpace(request, id, 'Phone desk')
  await page.setViewportSize({ width: 390, height: 844 })

  try {
    await page.goto(spacePath(id))
    await expect(page).toHaveURL(
      new RegExp(`${spacePath(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
    )
    await expect(page.getByTestId('space-shell')).toBeVisible()
    await expect(page.getByTestId('space-focus')).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Library pane' })).toBeVisible()
    await expect(page.getByTestId('infinite-canvas')).toHaveCount(0)
    await expect(page.getByTestId('canvas-minimap')).toHaveCount(0)
    await expect(page.getByTestId('workspace-window-visible-content')).toHaveCount(0)

    const libraryPane = page.locator('[data-testid="space-pane-host"][data-pane-id="pane-library"]')
    await libraryPane.getByText('Music', { exact: true }).click()
    await libraryPane.getByText('track.mp3', { exact: true }).click()
    const audio = page.locator('audio[data-playback-audio-host]')
    const audioChrome = page.locator('[data-playback-audio-chrome]')
    await expect(audio).toHaveCount(1)
    await expect(audioChrome).toBeVisible()
    const play = audioChrome.getByRole('button', { name: 'Play', exact: true })
    if (await play.isVisible()) await play.click()
    await expect
      .poll(() => audio.evaluate((element: HTMLAudioElement) => !element.paused))
      .toBe(true)

    await libraryPane.getByRole('button', { name: 'Home', exact: true }).click()
    await libraryPane.getByText('Videos', { exact: true }).click()
    await libraryPane.getByText('sample.mp4', { exact: true }).click()
    const videoTab = page.getByRole('tab', { name: 'sample.mp4', exact: true })
    await expect(videoTab).toBeVisible()
    const videoPaneId = await videoTab.getAttribute('data-focus-tab-id')
    expect(videoPaneId).toBeTruthy()
    const video = page.locator('video[title="sample.mp4"]')
    await expect(video).toBeVisible()
    await video.evaluate((element: HTMLVideoElement) => {
      element.playbackRate = 0.1
      void element.play()
    })
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => !element.paused))
      .toBe(true)
    await expect(video).toHaveAttribute('data-playback-generation', /\d+/)

    const firstCheckpoint = await video.evaluate((element: HTMLVideoElement) => {
      const target = Math.min(0.65, element.duration / 2)
      element.currentTime = target
      document
        .querySelector<HTMLButtonElement>('[role="tab"][data-focus-tab-id="pane-library"]')
        ?.click()
      return target
    })
    expect(firstCheckpoint).toBeGreaterThan(0.25)
    await expect
      .poll(() =>
        page.evaluate(
          ({ key, expected }) => {
            const persisted = JSON.parse(localStorage.getItem(key) ?? '{}') as {
              state?: { position?: number }
            }
            return Math.abs((persisted.state?.position ?? -1) - expected)
          },
          { key: OWNER_PLAYBACK_KEY, expected: firstCheckpoint },
        ),
      )
      .toBeLessThan(0.05)
    await expect(video).toHaveCount(0)
    await expect(page.locator(`[role="tab"][data-focus-tab-id="${videoPaneId}"]`)).toBeVisible()
    await expect(audioChrome).toBeVisible()
    await audio.evaluate((element: HTMLAudioElement) => {
      element.playbackRate = 0.1
    })
    await expect
      .poll(() => audio.evaluate((element: HTMLAudioElement) => !element.paused))
      .toBe(true)
    await expect
      .poll(() =>
        audio.evaluate(
          (element: HTMLAudioElement, expected: number) => Math.abs(element.currentTime - expected),
          firstCheckpoint,
        ),
      )
      .toBeLessThan(0.35)

    await audioChrome.getByRole('button', { name: 'Show video', exact: true }).click()
    await expect(page.locator(`[role="tab"][data-focus-tab-id="${videoPaneId}"]`)).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(video).toBeVisible()
    await expect(audioChrome).toHaveCount(0)
    await video.evaluate((element: HTMLVideoElement) => {
      element.playbackRate = 0.1
    })
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => !element.paused))
      .toBe(true)

    const loadedAssets = await page.evaluate(() =>
      performance.getEntriesByType('resource').map((entry) => entry.name),
    )
    expect(loadedAssets.some((url) => /\/(?:CanvasPage|WorkspacePage)-/.test(url))).toBe(false)

    await page.setViewportSize({ width: 1280, height: 800 })
    await choosePresentation(page, 'map')
    await expect(page.getByTestId('infinite-canvas')).toBeVisible()
    await expect(audioChrome).toBeVisible()
    await expect
      .poll(() => audio.evaluate((element: HTMLAudioElement) => !element.paused))
      .toBe(true)
    await page
      .locator('[data-testid="canvas-window"][data-window-id="pane-library"]')
      .getByTestId('canvas-window-titlebar')
      .click()
    await choosePresentation(page, 'focus')
    await expect(page.locator('[role="tab"][data-focus-tab-id="pane-library"]')).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(video).toHaveCount(0)
    await expect(audioChrome).toBeVisible()
    await videoTab.click()
    await expect(video).toBeVisible()
    await expect(video).toHaveAttribute('data-playback-generation', /\d+/)
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => !element.paused))
      .toBe(true)
  } finally {
    await deleteIfLive(request, id)
  }
})

test('switches Focus, Tiled, and Map without losing Pane identity or browser history', async ({
  page,
  request,
}, testInfo) => {
  test.slow()
  const id = uniqueId('stage7-presentations', testInfo)
  await createPresentationSpace(request, id)
  const historyKey = `derp-explorer-history:${id}:pane-library`

  try {
    await page.goto(spacePath(id, 'focus'))
    await expect(page.getByTestId('space-focus')).toBeVisible()
    await expect(page.getByTestId('space-picker')).toHaveValue(id)
    const libraryPane = page.locator('[data-testid="space-pane-host"][data-pane-id="pane-library"]')
    await expect(libraryPane).toBeVisible()
    await libraryPane.getByText('Documents', { exact: true }).click()
    await page.getByTestId('space-share-resource').click()
    const shareDialog = page.getByRole('dialog', { name: 'Share Links' })
    await expect(shareDialog).toBeVisible()
    await expect(shareDialog).toContainText('Documents')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Share Links' })).toHaveCount(0)
    await expect
      .poll(() =>
        page.evaluate((key) => {
          const raw = sessionStorage.getItem(key)
          return raw ? (JSON.parse(raw) as { entries: string[]; index: number }) : null
        }, historyKey),
      )
      .toEqual({ entries: ['', 'Documents'], index: 1 })

    await choosePresentation(page, 'tiled')
    await expect(page.getByTestId('workspace-window-visible-content').first()).toBeVisible()
    await expect(
      page.locator('[data-testid="space-pane-host"][data-pane-id="pane-library"]'),
    ).toBeVisible()

    await choosePresentation(page, 'map')
    await expect(page.getByTestId('infinite-canvas')).toBeVisible()
    await expect(page.getByTestId('canvas-window')).toHaveCount(2)
    await expect(page.getByTestId('canvas-minimap')).toBeVisible()
    await expect(
      page.locator('[data-testid="space-pane-host"][data-pane-id="pane-library"]'),
    ).toBeVisible()

    await page.context().setOffline(true)
    await page.getByTestId('space-add-resource').click()
    await expect(page.getByTestId('canvas-window')).toHaveCount(3)
    const addedPaneId = await page
      .locator('[data-testid="canvas-window"]')
      .last()
      .getAttribute('data-window-id')
    expect(addedPaneId).toBeTruthy()

    await choosePresentation(page, 'tiled')
    const tiledLibraryPane = page.locator(
      '[data-testid="space-pane-host"][data-pane-id="pane-library"]',
    )
    await tiledLibraryPane.getByRole('button', { name: 'Documents' }).press('Alt+ArrowLeft')
    await expect
      .poll(() =>
        page.evaluate((key) => {
          const raw = sessionStorage.getItem(key)
          return raw ? (JSON.parse(raw) as { entries: string[]; index: number }) : null
        }, historyKey),
      )
      .toEqual({ entries: ['', 'Documents'], index: 0 })

    await choosePresentation(page, 'focus')
    await expect(page.locator(`[role="tab"][data-focus-tab-id="${addedPaneId}"]`)).toBeVisible()
    await expect(page.locator('[role="tab"][data-focus-tab-id="pane-library"]')).toContainText(
      'Home',
    )
    await choosePresentation(page, 'tiled')
    await expect(page.getByTestId('workspace-stale-recovery-blocker')).toHaveCount(0)
    await expect(
      page.locator('[data-testid="space-pane-host"][data-pane-id="pane-library"]'),
    ).toBeVisible()
    await choosePresentation(page, 'focus')
    await page.context().setOffline(false)
    await expect(page.getByTestId('space-sync-status')).toHaveText('saved')
    const libraryTab = page.locator('[role="tab"][data-focus-tab-id="pane-library"]')
    const notesTab = page.locator('[role="tab"][data-focus-tab-id="pane-notes"]')
    await expect(libraryTab).toContainText('Home')
    await libraryTab.focus()
    await libraryTab.press('ArrowRight')
    await expect(notesTab).toBeFocused()
    await expect(notesTab).toHaveAttribute('aria-selected', 'true')
    await notesTab.press('ArrowLeft')
    await expect(libraryTab).toBeFocused()
    await expect(libraryTab).toHaveAttribute('aria-selected', 'true')

    await expect
      .poll(() =>
        page.evaluate((key) => {
          const raw = sessionStorage.getItem(key)
          return raw ? (JSON.parse(raw) as { entries: string[]; index: number }) : null
        }, historyKey),
      )
      .toEqual({ entries: ['', 'Documents'], index: 0 })

    const journaledPaneId = `reload-pane-${Date.now()}`
    await page.evaluate(
      ({ spaceId, paneId, pane }) => {
        localStorage.setItem(
          `derp-space-command-journal-v1:${encodeURIComponent(spaceId)}`,
          JSON.stringify({
            version: 1,
            spaceId,
            commands: [
              {
                commandId: `stage7-reload-${paneId}`,
                command: { type: 'addPane', paneId, pane },
              },
            ],
          }),
        )
      },
      { spaceId: id, paneId: journaledPaneId, pane: browserPane('Reloaded Pane') },
    )
    await page.reload()
    await expect(page.locator(`[role="tab"][data-focus-tab-id="${journaledPaneId}"]`)).toBeVisible()
    await expect(page.getByTestId('space-sync-status')).toHaveText('saved')
  } finally {
    await page.context().setOffline(false)
    await deleteIfLive(request, id)
  }
})

test('preserves editor, reader, and assistant drafts across every presentation', async ({
  page,
  request,
}, testInfo) => {
  test.slow()
  const id = uniqueId('stage7-content-continuity', testInfo)
  const editorPath = `Notes/${id}.md`
  await createContentContinuitySpace(request, id, editorPath)

  try {
    await page.goto(spacePath(id, 'focus'))
    await page.locator('[role="tab"][data-focus-tab-id="editor"]').click()
    const editor = page.getByRole('textbox', { name: `${id}.md Markdown editor` })
    await expect(editor).toBeVisible()
    await editor.press('Control+End')
    await editor.press('Enter')
    await editor.pressSequentially('unsaved presentation draft')

    await page.locator('[role="tab"][data-focus-tab-id="assistant"]').click()
    const composer = page.getByPlaceholder('Message Hermes…')
    await expect(composer).toBeVisible()
    await composer.fill('unsent assistant presentation draft')

    await page.locator('[role="tab"][data-focus-tab-id="reader"]').click()
    await expect(page.getByTestId('reader-dialog')).toBeVisible()
    const pageIndicator = page.getByTestId('reader-page-indicator')
    await expect(pageIndicator).toContainText('Page 1 / 4')
    await pageIndicator.click()
    await page.getByTestId('reader-page-input').fill('3')
    await page.getByTestId('reader-page-input').press('Enter')
    await expect(page.getByTestId('reader-page-indicator')).toContainText('Page 3 / 4')

    await choosePresentation(page, 'tiled')
    await choosePresentation(page, 'map')
    await choosePresentation(page, 'focus')

    await page.locator('[role="tab"][data-focus-tab-id="editor"]').click()
    await expect(page.getByRole('textbox', { name: `${id}.md Markdown editor` })).toContainText(
      'unsaved presentation draft',
    )
    await page.locator('[role="tab"][data-focus-tab-id="assistant"]').click()
    await expect(page.getByPlaceholder('Message Hermes…')).toHaveValue(
      'unsent assistant presentation draft',
    )
    await page.locator('[role="tab"][data-focus-tab-id="reader"]').click()
    await expect(page.getByTestId('reader-page-indicator')).toContainText('Page 3 / 4')
  } finally {
    await deleteIfLive(request, id)
  }
})

test('common Space shell renames, undoes, redoes, duplicates, and deletes', async ({
  page,
  request,
}, testInfo) => {
  const id = uniqueId('stage7-shell', testInfo)
  let duplicateId: string | null = null
  await createPresentationSpace(request, id, 'Shell desk')

  try {
    await page.goto(spacePath(id, 'focus'))
    const name = page.getByTestId('space-name')
    await name.fill('Renamed shell desk')
    await name.press('Enter')
    await expect(page.getByTestId('space-sync-status')).toHaveText('saved')
    await expect(name).toHaveValue('Renamed shell desk')

    await page.getByRole('button', { name: 'Undo Space change' }).click()
    await expect(name).toHaveValue('Shell desk')
    await expect(page.getByTestId('space-sync-status')).toHaveText('saved')

    await page.getByRole('button', { name: 'Redo Space change' }).click()
    await expect(name).toHaveValue('Renamed shell desk')
    await expect(page.getByTestId('space-sync-status')).toHaveText('saved')

    await name.fill('Second shell name')
    await name.press('Enter')
    await expect(page.getByTestId('space-sync-status')).toHaveText('saved')
    await name.fill('Third shell name')
    await name.press('Enter')
    await expect(page.getByTestId('space-sync-status')).toHaveText('saved')
    await page.getByRole('button', { name: 'Undo Space change' }).click()
    await expect(name).toHaveValue('Second shell name')
    await expect(page.getByTestId('space-sync-status')).toHaveText('saved')
    await page.getByRole('button', { name: 'Undo Space change' }).click()
    await expect(name).toHaveValue('Renamed shell desk')
    await expect(page.getByTestId('space-sync-status')).toHaveText('saved')

    await name.fill('Divergent shell name')
    await name.press('Enter')
    await expect(page.getByTestId('space-sync-status')).toHaveText('saved')
    await expect(page.getByRole('button', { name: 'Redo Space change' })).toBeDisabled()

    await page.getByTestId('space-history-trigger').click()
    await expect(page.getByRole('dialog', { name: 'Space revision history' })).toBeVisible()
    await expect(page.getByText('Revision 1', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Close revision history' }).click()

    await page.getByRole('button', { name: 'Duplicate Space' }).click()
    await expect(page).not.toHaveURL(spacePath(id, 'focus'))
    await expect(page).toHaveURL(/\/spaces\/id\/~[^/]+\/focus$/)
    duplicateId = decodeURIComponent(new URL(page.url()).pathname.split('/')[3]!.slice(1))
    expect(duplicateId).not.toBe(id)
    await expect(page.getByTestId('space-name')).toHaveValue('Divergent shell name copy')

    page.on('dialog', (dialog) => void dialog.accept())
    await page.getByRole('button', { name: 'Delete Space' }).click()
    await expect(page).toHaveURL(/\/spaces$/)
  } finally {
    await deleteIfLive(request, id)
    if (duplicateId) await deleteIfLive(request, duplicateId)
  }
})

test('legacy Workspace and Canvas URLs transition saved data but keep scratch local', async ({
  page,
  request,
}, testInfo) => {
  const workspaceSession = uniqueId('stage7-saved-workspace', testInfo)
  const workspaceSpaceId = uniqueId('stage7-workspace-space', testInfo)
  const scratchSession = uniqueId('stage7-scratch-workspace', testInfo)
  const canvasId = uniqueId('stage7-canvas-space', testInfo)
  const sourceKey = `workspace-state-ws-${workspaceSession}`
  const rawWorkspace = {
    windows: [],
    activeWindowId: null,
    activeTabMap: {},
    nextWindowId: 1,
    pinnedTaskbarItems: [],
  }
  const imported = await request.post('/api/spaces/import/workspaces', {
    data: {
      sourceKey,
      raw: JSON.stringify(rawWorkspace),
      id: workspaceSpaceId,
      name: 'Imported Workspace',
      panes: {},
      arrangements: {
        tiled: { placements: {}, paneOrder: [], tabGroups: {} },
      },
    },
  })
  expect(imported.ok()).toBe(true)

  try {
    await page.goto(`/workspace?ws=${encodeURIComponent(workspaceSession)}`)
    await expect(page).toHaveURL(spacePath(workspaceSpaceId, 'tiled'))
    await expect(page.getByTestId('space-shell')).toBeVisible()

    let scratchWrites = 0
    page.on('request', (current) => {
      if (
        new URL(current.url()).pathname === '/api/spaces/commands' &&
        current.method() === 'POST'
      ) {
        scratchWrites += 1
      }
    })
    await page.goto(`/workspace?ws=${encodeURIComponent(scratchSession)}`)
    await expect(page).toHaveURL(`/workspace?ws=${encodeURIComponent(scratchSession)}`)
    await expect(page.getByTestId('workspace-save-as-space')).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate((key) => localStorage.getItem(key), `workspace-state-ws-${scratchSession}`),
      )
      .not.toBeNull()
    expect(scratchWrites).toBe(0)

    await page.addInitScript(
      ({ id, updatedAt }) => {
        const state = {
          version: 1,
          windows: [],
          camera: { x: 25, y: -10, zoom: 0.9 },
          windowSizeByType: {},
          nextItemId: 1,
          nextZIndex: 1,
          maximizedWindowId: null,
        }
        localStorage.setItem(
          'infinite-canvases-v1',
          JSON.stringify({
            version: 1,
            activeId: id,
            writerId: 'stage7-playwright',
            lastTimestamp: updatedAt,
            canvases: [
              {
                id,
                name: 'Imported Canvas',
                state,
                updatedAt,
                writerId: 'stage7-playwright',
                deleted: false,
              },
            ],
          }),
        )
      },
      { id: canvasId, updatedAt: Date.now() },
    )
    await page.goto('/canvas')
    await expect(page).toHaveURL(spacePath(canvasId, 'map'))
    await expect(page.getByTestId('infinite-canvas')).toBeVisible()
  } finally {
    await deleteIfLive(request, workspaceSpaceId)
    await deleteIfLive(request, canvasId)
  }
})
