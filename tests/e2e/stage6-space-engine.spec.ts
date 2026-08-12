import { readFile } from 'node:fs/promises'
import { expect, test, type APIRequestContext, type TestInfo } from '@playwright/test'

function uniqueId(prefix: string, testInfo: TestInfo) {
  return [
    prefix,
    process.env.BATCH_ID ?? 'local',
    testInfo.workerIndex,
    Date.now(),
    Math.random().toString(36).slice(2, 8),
  ].join('-')
}

function spaceIdFromHref(href: string) {
  const token = new URL(href, 'http://localhost').pathname.split('/').at(-1) ?? ''
  if (!token.startsWith('~')) throw new Error(`Unexpected Space href: ${href}`)
  return decodeURIComponent(token.slice(1))
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

test('applies versioned commands, rejects stale revisions, and recovers history', async ({
  page,
  request,
}, testInfo) => {
  const id = uniqueId('stage6-space', testInfo)
  const duplicateId = uniqueId('stage6-copy', testInfo)
  const pane = {
    kind: 'browser',
    state: {
      title: 'Notes',
      source: { kind: 'local' },
      initialState: { dir: 'Notes' },
      resourceTarget: {
        ref: { libraryId: 'stage6-library', resourceId: 'stage6-resource' },
        legacyLocator: 'Notes',
      },
    },
  }
  try {
    const created = await request.post('/api/spaces/commands', {
      data: {
        command: {
          type: 'create',
          id,
          name: 'Versioned desk',
          origin: 'canvas',
          panes: { pane: pane },
          arrangements: {
            spatial: {
              placements: {
                pane: { bounds: { x: 8, y: 12, width: 640, height: 480 }, zIndex: 1 },
              },
            },
          },
        },
      },
    })
    expect(created.ok()).toBe(true)
    const createdBody = (await created.json()) as { space: { revision: number } }
    expect(createdBody.space.revision).toBe(1)

    const arranged = await request.post('/api/spaces/commands', {
      data: {
        spaceId: id,
        expectedRevision: 1,
        command: {
          type: 'applyArrangement',
          presentation: 'tiled',
          arrangement: {
            placements: { pane: { layout: { zIndex: 7, minimized: false } } },
            tabGroups: { pane: ['pane'] },
          },
        },
      },
    })
    expect(arranged.ok()).toBe(true)
    const arrangedBody = (await arranged.json()) as {
      space: { revision: number; panes: Record<string, unknown> }
    }
    expect(arrangedBody.space.revision).toBe(2)
    expect(arrangedBody.space.panes.pane).toEqual(pane)

    const stale = await request.post('/api/spaces/commands', {
      data: {
        spaceId: id,
        expectedRevision: 1,
        command: { type: 'rename', name: 'Stale write' },
      },
    })
    expect(stale.status()).toBe(409)
    await expect(stale.json()).resolves.toMatchObject({
      error: 'space_revision_conflict',
      expectedRevision: 1,
      currentRevision: 2,
      current: { id, revision: 2 },
    })

    const duplicated = await request.post('/api/spaces/commands', {
      data: {
        spaceId: id,
        expectedRevision: 2,
        command: {
          type: 'duplicate',
          sourceRevision: 1,
          newId: duplicateId,
          name: 'Recovered desk',
        },
      },
    })
    expect(duplicated.ok()).toBe(true)
    await expect(duplicated.json()).resolves.toMatchObject({
      space: { id: duplicateId, name: 'Recovered desk', revision: 1, panes: { pane } },
    })

    const deleted = await request.post('/api/spaces/commands', {
      data: { spaceId: id, expectedRevision: 2, command: { type: 'delete' } },
    })
    expect(deleted.ok()).toBe(true)

    await page.goto(`/spaces/id/~${encodeURIComponent(id)}`)
    await expect(page.getByTestId('space-deleted-recovery')).toContainText('This Space is deleted.')
    await expect(page.getByTestId('infinite-canvas')).toHaveCount(0)
    await page.getByTestId('space-history-trigger').click()
    await expect(page.getByRole('dialog', { name: 'Space revision history' })).toBeVisible()
    await expect(page.getByLabel('Restore revision 2')).toBeVisible()
    page.once('dialog', async (dialog) => {
      await dialog.accept()
    })
    await page.getByLabel('Restore revision 2').click()
    await expect(page.getByTestId('space-deleted-recovery')).toHaveCount(0)
    await expect(page.getByTestId('infinite-canvas')).toBeVisible()

    const restored = await request.get(`/api/spaces/by-id/~${encodeURIComponent(id)}`)
    expect(restored.ok()).toBe(true)
    await expect(restored.json()).resolves.toMatchObject({
      space: { id, revision: 4, panes: { pane } },
    })

    const history = await request.get(`/api/spaces/by-id/~${encodeURIComponent(id)}/history`)
    expect(history.ok()).toBe(true)
    const historyBody = (await history.json()) as {
      history: Array<{ revision: number; commandType: string }>
    }
    expect(historyBody.history.map((entry) => entry.revision)).toEqual([4, 3, 2, 1])
    expect(historyBody.history.map((entry) => entry.commandType)).toEqual([
      'restoreRevision',
      'delete',
      'applyArrangement',
      'create',
    ])
  } finally {
    await deleteIfLive(request, id)
    await deleteIfLive(request, duplicateId)
  }
})

test('imports Canvas records idempotently and quarantines later legacy overwrite', async ({
  request,
}, testInfo) => {
  const id = uniqueId('stage6-import', testInfo)
  const corruptId = uniqueId('stage6-corrupt', testInfo)
  const updatedAt = Date.now()
  const record = {
    id,
    name: 'Imported board',
    updatedAt,
    writerId: 'stage6-playwright',
    deleted: false,
    state: {
      version: 1,
      windows: [],
      camera: { x: 45, y: -12, zoom: 1.25 },
      windowSizeByType: { browser: { width: 777, height: 555 } },
      nextItemId: 9,
      nextZIndex: 11,
      maximizedWindowId: null,
    },
  }
  try {
    const first = await request.post('/api/spaces/import/canvases', {
      data: { canvases: [record] },
    })
    expect(first.ok()).toBe(true)
    await expect(first.json()).resolves.toMatchObject({
      spaces: [{ id, revision: 1, panes: {}, arrangements: { spatial: { placements: {} } } }],
      imports: [{ sourceKey: id, status: 'imported', raw: record }],
    })

    const repeated = await request.post('/api/spaces/import/canvases', {
      data: { canvases: [record] },
    })
    expect(repeated.ok()).toBe(true)
    await expect(repeated.json()).resolves.toMatchObject({
      spaces: [{ id, revision: 1 }],
      imports: [{ sourceKey: id, sourceDigest: expect.any(String) }],
    })

    const edited = await request.post('/api/spaces/commands', {
      data: {
        spaceId: id,
        expectedRevision: 1,
        command: { type: 'rename', name: 'Canonical edit' },
      },
    })
    expect(edited.ok()).toBe(true)
    const legacyOverwrite = await request.post('/api/spaces/import/canvases', {
      data: { canvases: [{ ...record, name: 'Legacy overwrite', updatedAt: updatedAt + 1 }] },
    })
    expect(legacyOverwrite.ok()).toBe(true)
    await expect(legacyOverwrite.json()).resolves.toMatchObject({
      spaces: [],
      imports: [{ sourceKey: id, status: 'quarantined', raw: { name: 'Legacy overwrite' } }],
    })
    const canonical = await request.get(`/api/spaces/by-id/~${encodeURIComponent(id)}`)
    await expect(canonical.json()).resolves.toMatchObject({
      space: { name: 'Canonical edit', revision: 2 },
    })

    const corrupt = await request.post('/api/spaces/import/canvases', {
      data: {
        canvases: [
          {
            id: corruptId,
            name: 'Broken board',
            writerId: 'stage6-playwright',
            updatedAt,
            deleted: false,
            state: { version: 99 },
          },
        ],
      },
    })
    expect(corrupt.ok()).toBe(true)
    await expect(corrupt.json()).resolves.toMatchObject({
      spaces: [],
      imports: [{ sourceKey: corruptId, status: 'quarantined', raw: { id: corruptId } }],
    })
  } finally {
    await deleteIfLive(request, id)
  }
})

test('/canvas imports its local source once and keeps camera state device-local', async ({
  page,
}, testInfo) => {
  const id = uniqueId('stage6-canvas-route', testInfo)
  const updatedAt = Date.now()
  let importRequestCount = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/spaces/import/canvases') {
      importRequestCount += 1
    }
  })
  await page.addInitScript(
    ({ canvasId, timestamp }) => {
      const seedKey = `stage6-canvas-seeded:${canvasId}`
      if (sessionStorage.getItem(seedKey)) return
      sessionStorage.setItem(seedKey, '1')
      const state = {
        version: 1,
        windows: [],
        camera: { x: 35, y: -20, zoom: 0.75 },
        windowSizeByType: { browser: { width: 700, height: 500 } },
        nextItemId: 4,
        nextZIndex: 8,
        maximizedWindowId: null,
      }
      localStorage.setItem(
        'infinite-canvases-v1',
        JSON.stringify({
          version: 1,
          activeId: canvasId,
          writerId: 'stage6-playwright',
          lastTimestamp: timestamp,
          canvases: [
            {
              id: canvasId,
              name: 'Route import',
              state,
              updatedAt: timestamp,
              writerId: 'stage6-playwright',
              deleted: false,
            },
          ],
        }),
      )
      localStorage.setItem('infinite-canvas-state-v1', JSON.stringify(state))
    },
    { canvasId: id, timestamp: updatedAt },
  )
  try {
    await page.goto('/canvas')
    const originalSource = await page.evaluate(() => localStorage.getItem('infinite-canvases-v1'))
    await expect(page).toHaveURL(/\/canvas$/)
    await expect(page.getByTestId('infinite-canvas')).toBeVisible()
    await expect(page.getByRole('slider', { name: 'Canvas zoom' })).toHaveValue('75')

    const imported = await page.request.get(`/api/spaces/by-id/~${encodeURIComponent(id)}`)
    expect(imported.ok()).toBe(true)
    const importedBody = (await imported.json()) as {
      space: { revision: number; panes: Record<string, unknown>; arrangements: unknown }
    }
    expect(importedBody.space).toMatchObject({
      revision: 1,
      panes: {},
      arrangements: { spatial: { placements: {} } },
    })

    await page.getByRole('slider', { name: 'Canvas zoom' }).press('ArrowUp')
    await expect(page.getByRole('slider', { name: 'Canvas zoom' })).not.toHaveValue('75')
    await page.waitForTimeout(1_100)
    const afterCamera = await page.request.get(`/api/spaces/by-id/~${encodeURIComponent(id)}`)
    const afterCameraBody = (await afterCamera.json()) as {
      space: { revision: number; updatedAt: number }
    }
    expect(afterCameraBody.space.revision).toBe(1)
    const localZoom = await page.getByRole('slider', { name: 'Canvas zoom' }).inputValue()
    await expect
      .poll(() =>
        page.evaluate((canvasId) => {
          const raw = localStorage.getItem(`space-session-canvas-${encodeURIComponent(canvasId)}`)
          if (!raw) return null
          const session = JSON.parse(raw) as { camera?: { zoom?: number } }
          const zoom = session.camera?.zoom
          return typeof zoom === 'number' ? String(Math.round(zoom * 100)) : null
        }, id),
      )
      .toBe(localZoom)
    expect(await page.evaluate(() => localStorage.getItem('infinite-canvases-v1'))).toBe(
      originalSource,
    )
    await page.reload()
    await expect(page.getByRole('slider', { name: 'Canvas zoom' })).toHaveValue(localZoom)
    expect(importRequestCount).toBe(1)
  } finally {
    await deleteIfLive(page.request, id)
  }
})

test('/canvas preserves corrupt source exactly and asks before creating a fallback', async ({
  page,
}) => {
  const raw = '{not valid canvas JSON\n  exact bytes stay here'
  let spaceRequests = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/spaces')) spaceRequests += 1
  })
  await page.addInitScript((value) => localStorage.setItem('infinite-canvases-v1', value), raw)

  await page.goto('/canvas')
  await expect(page.getByText('Canvas source needs attention')).toBeVisible()
  expect(spaceRequests).toBe(0)
  expect(await page.evaluate(() => localStorage.getItem('infinite-canvases-v1'))).toBe(raw)
  expect(
    await page.evaluate(() => localStorage.getItem('space-import-source-infinite-canvases-v1')),
  ).toBe(raw)

  await page.evaluate(() =>
    localStorage.setItem('infinite-canvases-v1', '{"later":"normalized write"}'),
  )

  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export exact original' }).click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toBe('canvas-import-source.json')
  expect(await readFile((await download.path())!, 'utf8')).toBe(raw)

  await page.getByTestId('canvas-import-continue').click()
  await expect(page.getByTestId('infinite-canvas')).toBeVisible()
  await expect(page).toHaveURL(/\/canvas$/)
  expect(
    await page.evaluate(() => localStorage.getItem('space-import-source-infinite-canvases-v1')),
  ).toBe(raw)
})

test('/canvas keeps local Canvas usable when Space API is unavailable', async ({ page }) => {
  const timestamp = Date.now()
  await page.addInitScript((updatedAt) => {
    const state = {
      version: 1,
      windows: [],
      camera: { x: 0, y: 0, zoom: 1 },
      windowSizeByType: {},
      nextItemId: 1,
      nextZIndex: 1,
      maximizedWindowId: null,
    }
    localStorage.setItem(
      'infinite-canvases-v1',
      JSON.stringify({
        version: 1,
        activeId: 'offline-canvas',
        writerId: 'offline-writer',
        lastTimestamp: updatedAt,
        canvases: [
          {
            id: 'offline-canvas',
            name: 'Offline Canvas',
            state,
            updatedAt,
            writerId: 'offline-writer',
            deleted: false,
          },
        ],
      }),
    )
  }, timestamp)
  await page.route('**/api/spaces**', (route) => route.abort('internetdisconnected'))

  await page.goto('/canvas')
  await expect(page.getByTestId('infinite-canvas')).toBeVisible()
  await expect(page.getByTestId('canvas-name-trigger')).toHaveText('Offline Canvas')
  await expect(page).toHaveURL(/\/canvas$/)
})

test('stale local Canvas recovery becomes a copy without overwriting newer Space panes', async ({
  page,
}, testInfo) => {
  test.slow()
  const id = uniqueId('stage6-canvas-stale-recovery', testInfo)
  const serverPane = {
    kind: 'viewer',
    state: {
      title: 'New server pane',
      iconPath: 'Documents/server.md',
      iconType: 'text',
      source: { kind: 'local' },
      initialState: { viewing: 'Documents/server.md' },
      tabGroupId: null,
    },
  }
  const created = await page.request.post('/api/spaces/commands', {
    data: {
      command: {
        type: 'create',
        id,
        name: 'Current Canvas',
        origin: 'canvas',
        panes: { 'canvas-window-2': serverPane },
        arrangements: {
          spatial: {
            placements: {
              'canvas-window-2': {
                bounds: { x: 16, y: 24, width: 640, height: 480 },
                zIndex: 2,
              },
            },
          },
        },
      },
    },
  })
  expect(created.ok()).toBe(true)
  const renamed = await page.request.post('/api/spaces/commands', {
    data: {
      spaceId: id,
      expectedRevision: 1,
      command: { type: 'rename', name: 'Newer server Canvas' },
    },
  })
  expect(renamed.ok()).toBe(true)
  await page.addInitScript((spaceId) => {
    const state = {
      version: 1,
      windows: [
        {
          id: 'canvas-window-1',
          definition: {
            id: 'canvas-window-1',
            type: 'viewer',
            title: 'Older local pane',
            iconPath: 'Documents/local.md',
            iconType: 'text',
            source: { kind: 'local' },
            initialState: { viewing: 'Documents/local.md' },
            tabGroupId: null,
          },
          bounds: { x: 0, y: 0, width: 640, height: 480 },
          zIndex: 1,
        },
      ],
      camera: { x: 90, y: -40, zoom: 0.8 },
      windowSizeByType: {},
      nextItemId: 2,
      nextZIndex: 2,
      maximizedWindowId: null,
    }
    const recoveryKey = `space-recovery-canvas-${encodeURIComponent(spaceId)}`
    if (localStorage.getItem(recoveryKey)) return
    localStorage.setItem(
      recoveryKey,
      JSON.stringify({
        version: 1,
        baseRevision: 1,
        name: 'Older local Canvas',
        raw: JSON.stringify(state),
      }),
    )
  }, id)

  let recoveredId: string | null = null
  try {
    await page.route('**/api/spaces/commands', (route) => route.abort('failed'))
    await page.goto(`/spaces/id/~${encodeURIComponent(id)}`)
    await expect(page.getByTestId('canvas-window')).toHaveCount(1)
    await expect(page.getByText('New server pane', { exact: true })).toBeVisible()
    await expect(page.getByText('Older local pane', { exact: true })).toHaveCount(0)
    await expect(page.getByTestId('canvas-sync-error')).toBeVisible()
    const recoveryBlocker = page.getByTestId('canvas-stale-recovery-blocker')
    await expect(recoveryBlocker).toBeVisible()
    const windowBounds = await page.getByTestId('canvas-window').boundingBox()
    expect(windowBounds).not.toBeNull()
    expect(
      await page.evaluate(
        ({ x, y }) => {
          return Boolean(
            document
              .elementFromPoint(x, y)
              ?.closest('[data-testid="canvas-stale-recovery-blocker"]'),
          )
        },
        { x: windowBounds!.x + 10, y: windowBounds!.y + 10 },
      ),
    ).toBe(true)
    const canvasRecoveryTitle = () =>
      page.evaluate((spaceId) => {
        const envelope = JSON.parse(
          localStorage.getItem(`space-recovery-canvas-${encodeURIComponent(spaceId)}`) ?? 'null',
        ) as { raw?: string } | null
        if (!envelope?.raw) return null
        const state = JSON.parse(envelope.raw) as {
          windows?: Array<{ definition?: { title?: string } }>
        }
        return state.windows?.[0]?.definition?.title ?? null
      }, id)
    await expect.poll(canvasRecoveryTitle).toBe('Older local pane')
    await expect(page.getByTestId('canvas-recovered-space-link')).toHaveCount(0)
    await page.reload()
    await expect(page.getByTestId('canvas-stale-recovery-blocker')).toBeVisible()
    await expect.poll(canvasRecoveryTitle).toBe('Older local pane')
    await page.unroute('**/api/spaces/commands')
    await page.getByTestId('canvas-stale-recovery-retry').click()
    const recoveredLink = page.getByTestId('canvas-recovered-space-link')
    await expect(recoveredLink).toBeVisible()
    const recoveredHref = await recoveredLink.getAttribute('href')
    recoveredId = spaceIdFromHref(recoveredHref!)

    const current = await page.request.get(`/api/spaces/by-id/~${encodeURIComponent(id)}`)
    await expect(current.json()).resolves.toMatchObject({
      space: {
        name: 'Newer server Canvas',
        revision: 2,
        panes: { 'canvas-window-2': serverPane },
      },
    })
    const recovered = await page.request.get(
      `/api/spaces/by-id/~${encodeURIComponent(recoveredId)}`,
    )
    await expect(recovered.json()).resolves.toMatchObject({
      space: {
        name: 'Older local Canvas (recovered)',
        revision: 1,
        panes: { 'canvas-window-1': { state: { title: 'Older local pane' } } },
      },
    })
  } finally {
    if (recoveredId) await deleteIfLive(page.request, recoveredId)
    await deleteIfLive(page.request, id)
  }
})

test('direct Canvas Space route preserves corrupt legacy source before local session writes', async ({
  page,
}, testInfo) => {
  const id = uniqueId('stage6-canvas-direct-preserve', testInfo)
  const raw = '{unexpected legacy Canvas bytes'
  const created = await page.request.post('/api/spaces/commands', {
    data: {
      command: {
        type: 'create',
        id,
        name: 'Direct Canvas',
        origin: 'canvas',
        panes: {},
        arrangements: { spatial: { placements: {} } },
      },
    },
  })
  expect(created.ok()).toBe(true)
  await page.addInitScript((value) => localStorage.setItem('infinite-canvases-v1', value), raw)

  try {
    await page.goto(`/spaces/id/~${encodeURIComponent(id)}`)
    await expect(page.getByTestId('infinite-canvas')).toBeVisible()
    await page.waitForTimeout(400)
    expect(await page.evaluate(() => localStorage.getItem('infinite-canvases-v1'))).toBe(raw)
    expect(
      await page.evaluate(() => localStorage.getItem('space-import-source-infinite-canvases-v1')),
    ).toBe(raw)
  } finally {
    await deleteIfLive(page.request, id)
  }
})

test('quarantines corrupt per-Space recovery until explicit discard', async ({
  page,
}, testInfo) => {
  const canvasId = uniqueId('stage6-canvas-recovery-corrupt', testInfo)
  const workspaceId = uniqueId('stage6-workspace-recovery-corrupt', testInfo)
  const canvasKey = `space-recovery-canvas-${encodeURIComponent(canvasId)}`
  const workspaceKey = `space-recovery-workspace-${encodeURIComponent(workspaceId)}`
  const canvasRaw = '{broken Canvas recovery bytes'
  const workspaceRaw = '{broken Workspace recovery bytes'
  for (const [id, name, origin, arrangements] of [
    [canvasId, 'Recovery Canvas', 'canvas', { spatial: { placements: {} } }],
    [
      workspaceId,
      'Recovery Workspace',
      'workspace',
      { tiled: { placements: {}, paneOrder: [], tabGroups: {} } },
    ],
  ] as const) {
    const response = await page.request.post('/api/spaces/commands', {
      data: { command: { type: 'create', id, name, origin, panes: {}, arrangements } },
    })
    expect(response.ok()).toBe(true)
  }
  await page.addInitScript(
    ({ canvasStorageKey, workspaceStorageKey, canvasValue, workspaceValue }) => {
      localStorage.setItem(canvasStorageKey, canvasValue)
      localStorage.setItem(workspaceStorageKey, workspaceValue)
    },
    {
      canvasStorageKey: canvasKey,
      workspaceStorageKey: workspaceKey,
      canvasValue: canvasRaw,
      workspaceValue: workspaceRaw,
    },
  )

  try {
    await page.goto(`/spaces/id/~${encodeURIComponent(canvasId)}`)
    await expect(page.getByTestId('canvas-corrupt-recovery')).toBeVisible()
    await page.waitForTimeout(500)
    expect(await page.evaluate((key) => localStorage.getItem(key), canvasKey)).toBe(canvasRaw)
    const canvasDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export original' }).click()
    expect((await canvasDownload).suggestedFilename()).toMatch(
      /^canvas-recovery-corrupt-\d+\.json$/,
    )
    page.once('dialog', (dialog) => dialog.dismiss())
    await page.getByRole('button', { name: 'Discard recovery' }).click()
    expect(await page.evaluate((key) => localStorage.getItem(key), canvasKey)).toBe(canvasRaw)

    await page.goto(`/spaces/id/~${encodeURIComponent(workspaceId)}`)
    await expect(page.getByTestId('workspace-corrupt-recovery')).toBeVisible()
    await page.waitForTimeout(500)
    expect(await page.evaluate((key) => localStorage.getItem(key), workspaceKey)).toBe(workspaceRaw)
    const workspaceDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export original' }).click()
    expect((await workspaceDownload).suggestedFilename()).toMatch(
      /^workspace-recovery-corrupt-\d+\.json$/,
    )
    page.once('dialog', (dialog) => dialog.dismiss())
    await page.getByRole('button', { name: 'Discard recovery' }).click()
    expect(await page.evaluate((key) => localStorage.getItem(key), workspaceKey)).toBe(workspaceRaw)
  } finally {
    await deleteIfLive(page.request, canvasId)
    await deleteIfLive(page.request, workspaceId)
  }
})

test('keeps Workspace scratch local until explicit save', async ({ page }, testInfo) => {
  const ws = uniqueId('stage6-workspace', testInfo)
  const spaceRequests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/spaces')) {
      spaceRequests.push(request.url())
    }
  })

  await page.goto(`/workspace?ws=${encodeURIComponent(ws)}`)
  await expect(page.getByTestId('workspace-save-as-space')).toBeVisible()
  await page.waitForTimeout(250)
  expect(spaceRequests).toEqual([])
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), `workspace-state-ws-${ws}`))
    .not.toBeNull()
  const rawSource = await page.evaluate(
    (key) => localStorage.getItem(key),
    `workspace-state-ws-${ws}`,
  )

  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('prompt')
    await dialog.accept('Saved Workspace')
  })
  await page.getByTestId('workspace-save-as-space').click()
  await page.waitForURL(/\/spaces\//)
  const id = spaceIdFromHref(page.url())
  try {
    const loaded = await page.request.get(`/api/spaces/by-id/~${encodeURIComponent(id)}`)
    expect(loaded.ok()).toBe(true)
    const loadedBody = (await loaded.json()) as { space: Record<string, unknown> }
    expect(loadedBody).toMatchObject({
      space: { id, name: 'Saved Workspace', origin: 'workspace', revision: 1 },
    })
    expect(JSON.stringify(loadedBody.space)).not.toContain('pinnedTaskbarItems')
    expect(JSON.stringify(loadedBody.space)).not.toContain('fileOpenTarget')
    const importsResponse = await page.request.get('/api/spaces/import-export')
    expect(importsResponse.ok()).toBe(true)
    const imports = (await importsResponse.json()) as {
      imports: Array<{
        sourceKind: string
        sourceKey: string
        spaceId?: string
        raw: unknown
      }>
    }
    expect(imports.imports).toContainEqual(
      expect.objectContaining({
        sourceKind: 'workspace',
        sourceKey: `workspace-state-ws-${ws}`,
        spaceId: id,
        raw: rawSource,
      }),
    )
    expect(
      await page.evaluate((key) => localStorage.getItem(key), `workspace-state-ws-${ws}`),
    ).not.toBeNull()

    await page.route('**/api/spaces/commands', (route) => route.abort('failed'))
    const browser = page.getByTestId('workspace-window-visible-content').first()
    await browser.getByText('Documents', { exact: true }).click()
    await expect(browser.getByText('readme.txt', { exact: true })).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(
          (spaceId) =>
            localStorage.getItem(`space-recovery-workspace-${encodeURIComponent(spaceId)}`),
          id,
        ),
      )
      .not.toBeNull()
    await expect(page.getByTestId('workspace-space-save-status')).toContainText(/failed|saving/, {
      timeout: 5000,
    })
    await page.unroute('**/api/spaces/commands')
    await page.reload()
    await expect(
      page.getByTestId('workspace-window-visible-content').first().getByText('readme.txt', {
        exact: true,
      }),
    ).toBeVisible()
    await expect(page.getByTestId('workspace-space-save-status')).toContainText('saved')
  } finally {
    await deleteIfLive(page.request, id)
  }
})

test('keeps stale Workspace recovery as a named copy instead of overwriting a newer revision', async ({
  page,
}, testInfo) => {
  test.slow()
  const id = uniqueId('stage6-workspace-stale-recovery', testInfo)
  const pane = {
    kind: 'browser',
    state: {
      title: 'Server browser',
      source: { kind: 'local', rootPath: null },
      initialState: {},
      iconName: null,
      iconPath: '',
      iconType: 'folder',
      iconIsVirtual: false,
    },
  }
  const created = await page.request.post('/api/spaces/commands', {
    data: {
      command: {
        type: 'create',
        id,
        name: 'Current Workspace',
        origin: 'workspace',
        panes: { 'workspace-window-1': pane },
        arrangements: {
          tiled: {
            placements: { 'workspace-window-1': { layout: {} } },
            paneOrder: ['workspace-window-1'],
            tabGroups: { 'workspace-window-1': ['workspace-window-1'] },
          },
        },
      },
    },
  })
  expect(created.ok()).toBe(true)
  const renamed = await page.request.post('/api/spaces/commands', {
    data: {
      spaceId: id,
      expectedRevision: 1,
      command: { type: 'rename', name: 'Newer server Workspace' },
    },
  })
  expect(renamed.ok()).toBe(true)
  await page.addInitScript((spaceId) => {
    const raw = JSON.stringify({
      windows: [
        {
          id: 'workspace-window-1',
          type: 'browser',
          title: 'Recovered browser',
          iconName: null,
          iconPath: '',
          iconType: 'folder',
          iconIsVirtual: false,
          source: { kind: 'local', rootPath: null },
          initialState: { dir: 'Documents' },
          tabGroupId: null,
          layout: {},
        },
      ],
      activeWindowId: 'workspace-window-1',
      activeTabMap: {},
      nextWindowId: 2,
      pinnedTaskbarItems: [],
    })
    const recoveryKey = `space-recovery-workspace-${encodeURIComponent(spaceId)}`
    if (localStorage.getItem(recoveryKey)) return
    localStorage.setItem(recoveryKey, JSON.stringify({ version: 1, baseRevision: 1, raw }))
  }, id)

  try {
    await page.route('**/api/spaces/commands', (route) => route.abort('failed'))
    await page.goto(`/spaces/id/~${encodeURIComponent(id)}`)
    await expect(page.getByTestId('workspace-space-save-status')).toContainText('failed')
    await expect(page.getByTestId('workspace-stale-recovery-blocker')).toBeVisible()
    const workspaceRecoveryTitle = () =>
      page.evaluate((spaceId) => {
        const envelope = JSON.parse(
          localStorage.getItem(`space-recovery-workspace-${encodeURIComponent(spaceId)}`) ?? 'null',
        ) as { raw?: string } | null
        if (!envelope?.raw) return null
        const state = JSON.parse(envelope.raw) as { windows?: Array<{ title?: string }> }
        return state.windows?.[0]?.title ?? null
      }, id)
    await expect.poll(workspaceRecoveryTitle).toBe('Recovered browser')
    await expect(page.getByRole('link', { name: 'Open recovered copy' })).toHaveCount(0)
    await page.reload()
    await expect(page.getByTestId('workspace-stale-recovery-blocker')).toBeVisible()
    await expect.poll(workspaceRecoveryTitle).toBe('Recovered browser')
    await page.unroute('**/api/spaces/commands')
    await page.getByTestId('workspace-stale-recovery-retry').click()
    await expect(page.getByTestId('workspace-space-save-status')).toContainText('conflict')
    const recoveredLink = page.getByRole('link', { name: 'Open recovered copy' })
    await expect(recoveredLink).toBeVisible()
    const recoveredHref = await recoveredLink.getAttribute('href')
    expect(recoveredHref).toMatch(/^\/spaces\//)
    const recoveredId = spaceIdFromHref(recoveredHref!)
    const current = await page.request.get(`/api/spaces/by-id/~${encodeURIComponent(id)}`)
    const currentJson = await current.json()
    expect(currentJson).toMatchObject({
      space: {
        name: 'Newer server Workspace',
        panes: {
          'workspace-window-1': { state: { title: 'Server browser' } },
        },
      },
    })
    expect(currentJson.space.revision).toBeGreaterThanOrEqual(2)
    const recovered = await page.request.get(
      `/api/spaces/by-id/~${encodeURIComponent(recoveredId)}`,
    )
    await expect(recovered.json()).resolves.toMatchObject({
      space: {
        name: 'Newer server Workspace (recovered)',
        revision: 1,
        panes: {
          'workspace-window-1': { state: { title: 'Recovered browser' } },
        },
      },
    })
    expect(
      await page.evaluate(
        (spaceId) =>
          localStorage.getItem(`space-recovery-workspace-${encodeURIComponent(spaceId)}`),
        id,
      ),
    ).not.toBeNull()
    await deleteIfLive(page.request, recoveredId)
  } finally {
    await deleteIfLive(page.request, id)
  }
})

test('retains and exposes a corrupt Workspace draft without uploading it', async ({
  page,
}, testInfo) => {
  const ws = uniqueId('stage6-corrupt-ws', testInfo)
  const key = `workspace-state-ws-${ws}`
  const raw = '{not valid workspace json'
  let spaceRequestCount = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/spaces')) spaceRequestCount += 1
  })
  await page.addInitScript(({ storageKey, value }) => localStorage.setItem(storageKey, value), {
    storageKey: key,
    value: raw,
  })
  await page.goto(`/workspace?ws=${encodeURIComponent(ws)}`)
  await expect(page.getByText('This local Workspace draft is unreadable.')).toBeVisible()
  expect(await page.evaluate((storageKey) => localStorage.getItem(storageKey), key)).toBe(raw)
  expect(spaceRequestCount).toBe(0)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export original draft' }).click()
  expect((await download).suggestedFilename()).toMatch(/^workspace-corrupt-\d+\.json$/)
  expect(await page.evaluate((storageKey) => localStorage.getItem(storageKey), key)).toBe(raw)
})

test('refreshes the Spaces list after returning through SPA navigation', async ({
  page,
  request,
}, testInfo) => {
  const firstId = uniqueId('stage6-list-first', testInfo)
  const addedId = uniqueId('stage6-list-added', testInfo)
  const create = (id: string, name: string) =>
    request.post('/api/spaces/commands', {
      data: {
        command: {
          type: 'create',
          id,
          name,
          origin: 'canvas',
          panes: {},
          arrangements: { spatial: { placements: {} } },
        },
      },
    })

  try {
    expect((await create(firstId, `First ${firstId}`)).ok()).toBe(true)
    await page.goto('/spaces')
    await expect(page.getByText(`First ${firstId}`, { exact: true })).toBeVisible()

    await page.getByText(`First ${firstId}`, { exact: true }).click()
    await expect(page.getByTestId('infinite-canvas')).toBeVisible()
    expect((await create(addedId, `Added ${addedId}`)).ok()).toBe(true)

    await page.goBack()
    await expect(page.getByTestId('spaces-page')).toBeVisible()
    await expect(page.getByText(`Added ${addedId}`, { exact: true })).toBeVisible()
  } finally {
    await deleteIfLive(request, firstId)
    await deleteIfLive(request, addedId)
  }
})
