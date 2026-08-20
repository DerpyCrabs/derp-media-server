import { expect, test, type Page } from '@playwright/test'
import { createWorkspaceE2EContext } from './workspace-e2e-context'
import { getDragHandle, getWindowGroups } from './workspace-layout-helpers'

async function gotoWorkspaceWithSSE(page: Page, url: string) {
  const streamRequest = page.waitForRequest(
    (request) => request.url().includes('/api/events/stream'),
    { timeout: 10_000 },
  )
  const consoleConnected = page.waitForEvent('console', {
    predicate: (message) => message.text().includes('[Admin SSE] Connected'),
    timeout: 10_000,
  })
  await page.goto(url)
  await Promise.race([streamRequest, consoleConnected])
}

test.describe('workspace registry', () => {
  test('creates, names, switches, and locks duplicate workspace views', async ({ browser }) => {
    const sharedContext = await createWorkspaceE2EContext(browser)
    const first = await sharedContext.newPage()
    const workspaceId = `registry-${Date.now()}`
    await first.goto(`/workspace?ws=${workspaceId}`)
    await expect(first.locator('.workspace-layout')).toBeVisible()

    await first.getByRole('button', { name: 'Open workspaces' }).click()
    const panel = first.getByTestId('workspace-switcher')
    await expect(panel).toBeVisible()
    const activeRow = panel.locator('.border-primary').first()
    await activeRow.dblclick()
    const name = `German ${Date.now()}`
    await activeRow.locator('input').fill(name)
    await activeRow.locator('input').press('Enter')
    await expect(activeRow).toContainText(name)

    await first.getByRole('button', { name: 'Open browser window' }).click()
    await expect(getWindowGroups(first)).toHaveCount(2)
    await first.getByRole('button', { name: 'Open workspaces' }).click()

    await panel.getByRole('button', { name: 'New workspace' }).click()
    await expect(first).not.toHaveURL(new RegExp(`ws=${workspaceId}(?:&|$)`))
    await expect(getWindowGroups(first)).toHaveCount(1)
    await first.getByRole('button', { name: 'Open workspaces' }).click()
    await expect(first.getByTestId('workspace-switcher')).toContainText(name)
    await expect(
      first
        .getByTestId('workspace-switcher')
        .locator(`[data-workspace-id="${workspaceId}"] .lucide-lock`),
    ).toHaveCount(0)
    const releasedView = await sharedContext.newPage()
    await releasedView.goto(`/workspace?ws=${workspaceId}`)
    await expect(releasedView.getByText('Read only — workspace is open elsewhere')).toBeHidden()
    await releasedView.evaluate(async (id) => {
      await fetch('/api/workspaces/release', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, clientId: sessionStorage.getItem('workspace-client-id') }),
      })
    }, workspaceId)
    await releasedView.close()
    await first.getByTestId('workspace-switcher').getByText(name, { exact: true }).click()
    await expect(first).toHaveURL(new RegExp(`ws=${workspaceId}(?:&|$)`))

    const duplicate = await sharedContext.newPage()
    await duplicate.goto(`/workspace?ws=${workspaceId}`)
    await expect(duplicate.getByText('Read only — workspace is open elsewhere')).toBeVisible()
    await duplicate.getByRole('button', { name: 'Open workspaces' }).click()
    const duplicateRow = duplicate
      .getByTestId('workspace-switcher')
      .locator(`[data-workspace-id="${workspaceId}"]`)
    await expect(duplicateRow.locator('.lucide-lock')).toBeVisible()
    await expect(duplicateRow).toContainText('Open in another tab')
    await duplicate.getByRole('button', { name: 'Take control' }).click()
    await expect(duplicate.getByText('Read only — workspace is open elsewhere')).toBeHidden()

    await sharedContext.close()
  })

  test('browser history switches sessions through flush, release, and open', async ({
    browser,
  }) => {
    const context = await createWorkspaceE2EContext(browser)
    const page = await context.newPage()
    const firstId = `history-first-${Date.now()}`

    try {
      await page.goto(`/workspace?ws=${firstId}`)
      await expect(page.locator('[data-workspace-opened]')).toBeAttached()
      await page.getByRole('button', { name: 'Open browser window' }).click()
      await expect(getWindowGroups(page)).toHaveCount(2)

      await page.getByRole('button', { name: 'Open workspaces' }).click()
      await page.getByRole('button', { name: 'New workspace' }).click()
      await expect(page).not.toHaveURL(new RegExp(`ws=${firstId}(?:&|$)`))
      const secondId = new URL(page.url()).searchParams.get('ws')!
      expect(secondId).not.toBe(firstId)
      await expect(page.locator('[data-workspace-opened]')).toBeAttached()
      await expect(getWindowGroups(page)).toHaveCount(1)

      await page.goBack()
      await expect(page).toHaveURL(new RegExp(`ws=${firstId}(?:&|$)`))
      await expect(page.locator('[data-workspace-opened]')).toBeAttached()
      await expect(getWindowGroups(page)).toHaveCount(2)

      const releasedSecond = await context.newPage()
      await releasedSecond.goto(`/workspace?ws=${secondId}`)
      await expect(releasedSecond.getByText('Read only — workspace is open elsewhere')).toBeHidden()
      await releasedSecond.evaluate(async (id) => {
        await fetch('/api/workspaces/release', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id, clientId: sessionStorage.getItem('workspace-client-id') }),
        })
      }, secondId)
      await releasedSecond.close()

      await page.goForward()
      await expect(page).toHaveURL(new RegExp(`ws=${secondId}(?:&|$)`))
      await expect(page.locator('[data-workspace-opened]')).toBeAttached()
      await expect(getWindowGroups(page)).toHaveCount(1)
    } finally {
      await context.close()
    }
  })

  test('edits inactive workspace metadata and opens only inactive workspaces in new tabs', async ({
    browser,
  }) => {
    const context = await createWorkspaceE2EContext(browser)
    const page = await context.newPage()
    const currentId = `metadata-current-${Date.now()}`
    await page.goto(`/workspace?ws=${currentId}`)
    await expect(page.getByRole('button', { name: 'Open workspaces' })).toBeVisible()

    await page.getByRole('button', { name: 'Open workspaces' }).click()
    await page.getByRole('button', { name: 'New workspace' }).click()
    await expect(page).not.toHaveURL(new RegExp(`ws=${currentId}(?:&|$)`))
    const inactiveId = new URL(page.url()).searchParams.get('ws')!
    expect(inactiveId).not.toBe(currentId)

    await page.getByRole('button', { name: 'Open workspaces' }).click()
    await page
      .getByTestId('workspace-switcher')
      .locator(`[data-workspace-id="${currentId}"]`)
      .getByRole('button')
      .click()
    await expect(page).toHaveURL(new RegExp(`ws=${currentId}(?:&|$)`))

    await page.getByRole('button', { name: 'Open workspaces' }).click()
    const panel = page.getByTestId('workspace-switcher')
    const inactiveRow = panel.locator(`[data-workspace-id="${inactiveId}"]`)
    await inactiveRow.click({ button: 'right' })
    await page.getByRole('button', { name: 'Rename' }).click()
    const inactiveName = `Inactive ${Date.now()}`
    await inactiveRow.locator('input').fill(inactiveName)
    await inactiveRow.locator('input').press('Enter')
    await expect(inactiveRow).toContainText(inactiveName)

    const currentRow = panel.locator(`[data-workspace-id="${currentId}"]`)
    await currentRow.click({ button: 'right' })
    await expect(page.getByRole('button', { name: 'Open in new tab' })).toHaveCount(0)
    await page.mouse.click(600, 400)
    await expect(panel).toBeHidden()
    await page.getByRole('button', { name: 'Open workspaces' }).click()

    await inactiveRow.click({ button: 'right' })
    const newPagePromise = context.waitForEvent('page')
    await page.getByRole('button', { name: 'Open in new tab' }).click()
    const newPage = await newPagePromise
    await newPage.waitForLoadState('domcontentloaded')
    await expect(newPage).toHaveURL(new RegExp(`ws=${inactiveId}(?:&|$)`))
    const [currentClientId, newClientId] = await Promise.all([
      page.evaluate(() => sessionStorage.getItem('workspace-client-id')),
      newPage.evaluate(() => sessionStorage.getItem('workspace-client-id')),
    ])
    expect(newClientId).not.toBe(currentClientId)

    await context.close()
  })

  test('syncs live workspace edits between independent pages through SSE', async ({ browser }) => {
    const writerContext = await createWorkspaceE2EContext(browser)
    const observerContext = await createWorkspaceE2EContext(browser)
    const writer = await writerContext.newPage()
    const observer = await observerContext.newPage()
    const workspaceId = `workspace-sse-${Date.now()}`

    try {
      await gotoWorkspaceWithSSE(writer, `/workspace?ws=${workspaceId}`)
      await expect(getWindowGroups(writer)).toHaveCount(1)

      await gotoWorkspaceWithSSE(observer, `/workspace?ws=${workspaceId}`)
      await expect(observer.getByText('Read only — workspace is open elsewhere')).toBeVisible()
      await expect(getWindowGroups(observer)).toHaveCount(1)

      const mutationStartedAt = Date.now()
      await writer.getByRole('button', { name: 'Open browser window' }).click()
      await expect(getWindowGroups(writer)).toHaveCount(2)
      await expect
        .poll(
          async () =>
            writer.request
              .get('/api/workspaces')
              .then((response) => response.json())
              .then((registry) => registry.records[workspaceId]?.snapshot.windows.length ?? 0),
          { timeout: 5_000, intervals: [50, 100, 200] },
        )
        .toBe(2)

      await expect
        .poll(() => getWindowGroups(observer).count(), {
          timeout: 5_000,
          intervals: [50, 100, 200],
        })
        .toBe(2)
      expect(Date.now() - mutationStartedAt).toBeLessThan(3_000)
    } finally {
      await observerContext.close()
      await writerContext.close()
    }
  })

  test('accepts an authoritative active-workspace replacement without saving stale state', async ({
    browser,
  }) => {
    const context = await createWorkspaceE2EContext(browser)
    const page = await context.newPage()
    const workspaceId = `workspace-remote-replace-${Date.now()}`

    try {
      await gotoWorkspaceWithSSE(page, `/workspace?ws=${workspaceId}`)
      await expect(getWindowGroups(page)).toHaveCount(1)
      const clientId = await page.evaluate(() => sessionStorage.getItem('workspace-client-id'))
      const before = await page.request
        .get(`/api/workspaces?clientId=${encodeURIComponent(clientId!)}`)
        .then((response) => response.json())
      const record = before.records[workspaceId]
      const snapshot = {
        ...record.snapshot,
        windows: [
          ...record.snapshot.windows,
          {
            id: 'external-browser',
            type: 'browser',
            title: 'External browser',
            source: { kind: 'local' },
            initialState: { dir: 'Documents' },
            tabGroupId: null,
            layout: { bounds: { x: 700, y: 80, width: 560, height: 480 }, zIndex: 2 },
          },
        ],
        activeWindowId: 'external-browser',
        nextWindowId: record.snapshot.nextWindowId + 1,
      }
      const saved = await page.request.post('/api/workspaces/save', {
        data: {
          id: workspaceId,
          clientId,
          revision: record.revision,
          snapshot,
        },
      })
      expect(saved.ok()).toBe(true)
      const savedRevision = (await saved.json()).revision

      await expect(getWindowGroups(page)).toHaveCount(2)
      await page.getByRole('button', { name: 'Open workspaces' }).click()
      await page.getByRole('button', { name: 'New workspace' }).click()
      await expect(page).not.toHaveURL(new RegExp(`ws=${workspaceId}(?:&|$)`))

      const after = await page.request
        .get(`/api/workspaces?clientId=${encodeURIComponent(clientId!)}`)
        .then((response) => response.json())
      expect(after.records[workspaceId].revision).toBe(savedRevision)
      expect(after.records[workspaceId].snapshot.windows).toHaveLength(2)
    } finally {
      await context.close()
    }
  })

  test('continues saving after active workspace metadata changes its revision', async ({
    browser,
  }) => {
    const context = await createWorkspaceE2EContext(browser)
    const page = await context.newPage()
    const workspaceId = `metadata-revision-${Date.now()}`

    try {
      await page.goto(`/workspace?ws=${workspaceId}`)
      await expect(getWindowGroups(page)).toHaveCount(1)
      await page.getByRole('button', { name: 'Open workspaces' }).click()
      const row = page.locator(`[data-workspace-id="${workspaceId}"]`)
      await row.click({ button: 'right' })
      await page.getByRole('button', { name: 'Rename' }).click()
      await row.locator('input').fill('Revision owner')
      await row.locator('input').press('Enter')
      await expect(row).toContainText('Revision owner')
      await page.getByRole('button', { name: 'Open workspaces' }).click()

      await page.getByRole('button', { name: 'Open browser window' }).click()
      await expect(getWindowGroups(page)).toHaveCount(2)
      await expect
        .poll(
          async () =>
            page.request
              .get('/api/workspaces')
              .then((response) => response.json())
              .then((registry) => registry.records[workspaceId]?.snapshot.windows.length ?? 0),
          { timeout: 5_000, intervals: [50, 100, 200] },
        )
        .toBe(2)
      await expect(page.getByText('Read only — workspace is open elsewhere')).toBeHidden()
    } finally {
      await context.close()
    }
  })

  test('drags a window through the workspace rail into another route', async ({ browser }) => {
    const sharedContext = await createWorkspaceE2EContext(browser)
    const page = await sharedContext.newPage()
    const sourceId = `drag-source-${Date.now()}`
    await page.goto(`/workspace?ws=${sourceId}`)
    await expect(getWindowGroups(page)).toHaveCount(1)

    await page.getByRole('button', { name: 'Open workspaces' }).click()
    await page.getByRole('button', { name: 'New workspace' }).click()
    await expect(page).not.toHaveURL(new RegExp(`ws=${sourceId}(?:&|$)`))
    const destinationId = new URL(page.url()).searchParams.get('ws')!
    await expect(getWindowGroups(page)).toHaveCount(1)
    await page.getByRole('button', { name: 'Open workspaces' }).click()
    await page
      .getByTestId('workspace-switcher')
      .locator(`[data-workspace-id="${sourceId}"]`)
      .click()
    await expect(page).toHaveURL(new RegExp(`ws=${sourceId}(?:&|$)`))
    await page.getByRole('button', { name: 'Open workspaces' }).click()
    const activeSourceRow = page
      .getByTestId('workspace-switcher')
      .locator('.border-primary')
      .first()
    await activeSourceRow.dblclick()
    await activeSourceRow.locator('input').fill('')
    await activeSourceRow.locator('input').press('Enter')
    await page.mouse.click(600, 400)

    const handle = getDragHandle(getWindowGroups(page).first())
    const box = await handle.boundingBox()
    if (!box) throw new Error('Window drag handle is unavailable')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(5, 120, { steps: 12 })
    const panel = page.getByTestId('workspace-switcher')
    await expect(panel).toBeVisible()
    const target = panel.locator(`[data-workspace-id="${destinationId}"]`)
    await target.scrollIntoViewIfNeeded()
    const targetBox = await target.boundingBox()
    if (!targetBox) throw new Error('Workspace drop target is unavailable')
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2)
    await expect(target).toContainText('Hold to move here')
    await expect(target.locator('.workspace-dwell-progress')).toBeVisible()
    await page.waitForTimeout(1_100)
    await expect(target).toContainText('Release to move here')
    await expect(page).toHaveURL(new RegExp(`ws=${sourceId}(?:&|$)`))
    await page.mouse.up()
    await expect(page).toHaveURL(new RegExp(`ws=${destinationId}(?:&|$)`))
    await expect(getWindowGroups(page)).toHaveCount(2)
    await expect
      .poll(async () => {
        const response = await page.request.get('/api/workspaces')
        const registry = (await response.json()) as { order: string[] }
        return registry.order.includes(sourceId)
      })
      .toBe(false)

    await sharedContext.close()
  })

  test('does not drop into an armed workspace after leaving its row', async ({ browser }) => {
    const context = await createWorkspaceE2EContext(browser)
    const page = await context.newPage()
    const sourceId = `armed-leave-source-${Date.now()}`
    await page.goto(`/workspace?ws=${sourceId}`)
    await expect(getWindowGroups(page)).toHaveCount(1)

    await page.getByRole('button', { name: 'Open workspaces' }).click()
    await page.getByRole('button', { name: 'New workspace' }).click()
    await expect(page).not.toHaveURL(new RegExp(`ws=${sourceId}(?:&|$)`))
    const destinationId = new URL(page.url()).searchParams.get('ws')!
    await expect(getWindowGroups(page)).toHaveCount(1)
    const destinationWindowCount = await getWindowGroups(page).count()
    await page.getByRole('button', { name: 'Open workspaces' }).click()
    await page
      .getByTestId('workspace-switcher')
      .locator(`[data-workspace-id="${sourceId}"]`)
      .click()
    await page.getByRole('button', { name: 'Open workspaces' }).click()

    const handle = getDragHandle(getWindowGroups(page).first())
    const handleBox = await handle.boundingBox()
    if (!handleBox) throw new Error('Window drag handle is unavailable')
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(5, 120, { steps: 12 })

    const target = page
      .getByTestId('workspace-switcher')
      .locator(`[data-workspace-id="${destinationId}"]`)
    await target.scrollIntoViewIfNeeded()
    const targetBox = await target.boundingBox()
    if (!targetBox) throw new Error('Workspace drop target is unavailable')
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2)
    await page.waitForTimeout(1_100)
    await expect(target).toContainText('Release to move here')

    await page.mouse.move(500, 400, { steps: 5 })
    await page.mouse.up()

    await expect(page).toHaveURL(new RegExp(`ws=${sourceId}(?:&|$)`))
    await expect(getWindowGroups(page)).toHaveCount(1)
    await expect
      .poll(async () => {
        const response = await page.request.get('/api/workspaces')
        const registry = (await response.json()) as {
          records: Record<string, { snapshot: { windows: unknown[] } }>
        }
        return registry.records[destinationId]?.snapshot.windows.length ?? 0
      })
      .toBe(destinationWindowCount)

    await context.close()
  })

  test('moving a window cannot resurrect it in the source workspace', async ({ browser }) => {
    const context = await createWorkspaceE2EContext(browser)
    const page = await context.newPage()
    const sourceId = `move-once-source-${Date.now()}`
    const destinationId = `move-once-destination-${Date.now()}`
    const destinationName = `Move once target ${Date.now()}`
    await page.goto(`/workspace?ws=${sourceId}`)
    await expect(getWindowGroups(page)).toHaveCount(1)
    await expect
      .poll(async () => {
        const registry = await page.request
          .get('/api/workspaces')
          .then((response) => response.json())
        return registry.records[sourceId]?.snapshot.windows.length
      })
      .toBe(1)

    await page.evaluate(
      async ({ sourceId, destinationId, destinationName }) => {
        const clientId = sessionStorage.getItem('workspace-client-id')
        const nameWorkspace = async (id: string, name: string) => {
          const registry = await fetch(
            `/api/workspaces?clientId=${encodeURIComponent(clientId ?? '')}`,
          ).then((response) => response.json())
          const record = registry.records[id]
          await fetch('/api/workspaces/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id,
              clientId,
              revision: record.revision,
              snapshot: record.snapshot,
              metadata: { name, icon: null, iconColor: null },
            }),
          })
        }
        await nameWorkspace(sourceId, 'Move once source')
        await fetch('/api/workspaces/open', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: destinationId,
            clientId,
            snapshot: {
              workspaceType: 'desktop',
              windows: [],
              activeWindowId: null,
              activeTabMap: {},
              nextWindowId: 1,
            },
          }),
        })
        await nameWorkspace(destinationId, destinationName)
      },
      { sourceId, destinationId, destinationName },
    )
    await page.reload()

    const handle = getDragHandle(getWindowGroups(page).first())
    const box = await handle.boundingBox()
    if (!box) throw new Error('Window drag handle is unavailable')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(5, 120, { steps: 12 })
    const target = page
      .getByTestId('workspace-switcher')
      .getByText(destinationName, { exact: true })
    await target.scrollIntoViewIfNeeded()
    const targetBox = await target.boundingBox()
    if (!targetBox) throw new Error('Workspace drop target is unavailable')
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2)
    await page.waitForTimeout(1_100)
    await page.mouse.up()
    await expect(page).toHaveURL(new RegExp(`ws=${destinationId}(?:&|$)`))
    await expect(getWindowGroups(page)).toHaveCount(1)
    const releasedSource = await context.newPage()
    await releasedSource.goto(`/workspace?ws=${sourceId}`)
    await expect(releasedSource.getByText('Read only — workspace is open elsewhere')).toBeHidden()
    await expect(getWindowGroups(releasedSource)).toHaveCount(0)
    await releasedSource.evaluate(async (id) => {
      await fetch('/api/workspaces/release', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, clientId: sessionStorage.getItem('workspace-client-id') }),
      })
    }, sourceId)
    await releasedSource.close()
    await page.getByRole('button', { name: 'Open workspaces' }).click()
    const sourceRow = page
      .getByTestId('workspace-switcher')
      .locator(`[data-workspace-id="${sourceId}"]`)
    await expect(sourceRow).toBeVisible()
    await sourceRow.click()
    await expect(page).toHaveURL(new RegExp(`ws=${sourceId}(?:&|$)`))
    await expect(getWindowGroups(page)).toHaveCount(0)
    await page.waitForTimeout(750)
    await page.reload()
    await expect(getWindowGroups(page)).toHaveCount(0)
    await expect
      .poll(async () => {
        const registry = await page.request
          .get('/api/workspaces')
          .then((response) => response.json())
        return {
          source: registry.records[sourceId]?.snapshot.windows.length,
          destination: registry.records[destinationId]?.snapshot.windows.length,
        }
      })
      .toEqual({ source: 0, destination: 1 })

    await context.close()
  })

  test('opens centered panel by click and drops a window into a fresh workspace', async ({
    browser,
  }) => {
    const context = await createWorkspaceE2EContext(browser)
    const page = await context.newPage()
    const sourceId = `fresh-drop-${Date.now()}`
    await page.goto(`/workspace?ws=${sourceId}`)
    await expect(getWindowGroups(page)).toHaveCount(1)

    const edgeHandle = page.getByTestId('workspace-edge-handle')
    await expect(edgeHandle).toBeHidden()
    await page.getByRole('button', { name: 'Open workspaces' }).click()
    const panel = page.getByTestId('workspace-switcher')
    const box = await panel.boundingBox()
    const viewport = page.viewportSize()!
    expect(box).not.toBeNull()
    expect(box!.height).toBeLessThan(viewport.height * 0.8)
    expect(Math.abs(box!.y + box!.height / 2 - viewport.height / 2)).toBeLessThan(3)

    await page.getByRole('button', { name: 'Open workspaces' }).click()
    await expect(panel).toBeHidden()
    await expect(edgeHandle).toBeHidden()

    await page.mouse.move(5, viewport.height / 2)
    await page.waitForTimeout(500)
    await expect(panel).toBeHidden()

    await page.mouse.move(500, viewport.height / 2)

    const dragHandle = getDragHandle(getWindowGroups(page).first())
    const dragBox = await dragHandle.boundingBox()
    if (!dragBox) throw new Error('Window drag handle is unavailable')
    await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(dragBox.x + dragBox.width / 2 + 12, dragBox.y + dragBox.height / 2)
    await expect(edgeHandle).toBeVisible()
    await page.mouse.move(5, viewport.height / 2, { steps: 12 })
    await expect(panel).toBeVisible()
    await page.mouse.move(500, viewport.height / 2, { steps: 5 })
    await expect(panel).toBeHidden()
    await page.mouse.move(5, viewport.height / 2, { steps: 12 })
    await expect(panel).toBeVisible()
    const freshTarget = panel.locator('[data-workspace-id="__new__"]')
    await freshTarget.scrollIntoViewIfNeeded()
    const freshBox = await freshTarget.boundingBox()
    if (!freshBox) throw new Error('New workspace drop target is unavailable')
    await page.mouse.move(freshBox.x + freshBox.width / 2, freshBox.y + freshBox.height / 2)
    await expect(freshTarget).toContainText('Hold to create and move')
    await page.mouse.up()

    await expect(page).not.toHaveURL(new RegExp(`ws=${sourceId}(?:&|$)`))
    await expect(getWindowGroups(page)).toHaveCount(1)
    await expect(panel).toBeHidden()
    await context.close()
  })

  test('creates a fresh workspace atomically on drop, not during dwell', async ({ browser }) => {
    const context = await createWorkspaceE2EContext(browser)
    const page = await context.newPage()
    const sourceId = `dwell-new-${Date.now()}`
    await page.goto(`/workspace?ws=${sourceId}`)
    await expect(page.locator('[data-workspace-opened]')).toBeAttached()
    const handle = getDragHandle(getWindowGroups(page).first())
    const handleBox = await handle.boundingBox()
    if (!handleBox) throw new Error('Window drag handle is unavailable')
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(5, 350, { steps: 12 })
    const panel = page.getByTestId('workspace-switcher')
    const rowsBefore = await panel
      .locator('[data-workspace-id]:not([data-workspace-id="__new__"])')
      .count()
    const target = panel.locator('[data-workspace-id="__new__"]')
    await target.scrollIntoViewIfNeeded()
    const targetBox = await target.boundingBox()
    if (!targetBox) throw new Error('New workspace drop target is unavailable')
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2)
    await page.waitForTimeout(1_100)

    await expect(page).toHaveURL(new RegExp(`ws=${sourceId}(?:&|$)`))
    await expect(
      panel.locator('[data-workspace-id]:not([data-workspace-id="__new__"])'),
    ).toHaveCount(rowsBefore)
    await page.mouse.up()
    await expect(page).not.toHaveURL(new RegExp(`ws=${sourceId}(?:&|$)`))
    const destinationId = new URL(page.url()).searchParams.get('ws')
    if (!destinationId) throw new Error('Created workspace id is unavailable')
    await expect(page).toHaveURL(new RegExp(`ws=${destinationId}(?:&|$)`))
    await expect(getWindowGroups(page)).toHaveCount(1)
    await expect
      .poll(async () => {
        const registry = await page.request
          .get('/api/workspaces')
          .then((response) => response.json())
        return registry.records[destinationId]?.snapshot.windows.length
      })
      .toBe(1)
    await context.close()
  })
})
