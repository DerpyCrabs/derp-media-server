import { expect, test } from '@playwright/test'
import { createWorkspaceE2EContext } from './workspace-e2e-context'
import { getDragHandle, getWindowGroups } from './workspace-layout-helpers'

test.describe('workspace registry', () => {
  test.describe.configure({ timeout: 30_000 })

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
    await expect(first.getByTestId('workspace-switcher').locator('.lucide-lock')).toHaveCount(0)
    await first.getByTestId('workspace-switcher').getByText(name, { exact: true }).click()
    await expect(first).toHaveURL(new RegExp(`ws=${workspaceId}(?:&|$)`))

    const duplicate = await sharedContext.newPage()
    await duplicate.goto(`/workspace?ws=${workspaceId}`)
    await expect(duplicate.getByText('Read only — workspace is open elsewhere')).toBeVisible()
    await duplicate.getByRole('button', { name: 'Open workspaces' }).click()
    await duplicate.getByRole('button', { name: 'Take control' }).click()
    await expect(duplicate.getByText('Read only — workspace is open elsewhere')).toBeHidden()

    await sharedContext.close()
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

  test('drags a window through the workspace rail into another route', async ({ browser }) => {
    const sharedContext = await createWorkspaceE2EContext(browser)
    const page = await sharedContext.newPage()
    const sourceId = `drag-source-${Date.now()}`
    const destinationName = `Drop target ${sourceId}`
    await page.goto(`/workspace?ws=${sourceId}`)
    await expect(getWindowGroups(page)).toHaveCount(1)
    await page.evaluate(async () => {
      const clientId = sessionStorage.getItem('workspace-client-id')
      const id = new URL(location.href).searchParams.get('ws')
      await fetch('/api/workspaces/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, clientId, name: 'Drag source' }),
      })
    })

    await page.getByRole('button', { name: 'Open workspaces' }).click()
    await page.getByRole('button', { name: 'New workspace' }).click()
    const destinationId = new URL(page.url()).searchParams.get('ws')!
    await expect(getWindowGroups(page)).toHaveCount(1)
    await page.evaluate(async (name) => {
      const clientId = sessionStorage.getItem('workspace-client-id')
      const id = new URL(location.href).searchParams.get('ws')
      await fetch('/api/workspaces/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, clientId, name }),
      })
    }, destinationName)
    await page.getByRole('button', { name: 'Open workspaces' }).click()
    await page.getByTestId('workspace-switcher').getByText('Drag source', { exact: true }).click()
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
    const target = panel.getByText(destinationName, { exact: true })
    await target.scrollIntoViewIfNeeded()
    const targetBox = await target.boundingBox()
    if (!targetBox) throw new Error('Workspace drop target is unavailable')
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2)
    const targetRow = target.locator('xpath=ancestor::*[@data-workspace-id][1]')
    await expect(targetRow).toContainText('Hold to move here')
    await expect(targetRow.locator('.workspace-dwell-progress')).toBeVisible()
    await page.waitForTimeout(1_100)
    await expect(page).toHaveURL(new RegExp(`ws=${destinationId}(?:&|$)`), { timeout: 20_000 })
    await page.mouse.move(500, 300, { steps: 5 })
    await page.mouse.up()
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

  test('toggles centered panel and drops a window into a fresh workspace', async ({ browser }) => {
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
    await page.waitForTimeout(100)
    await expect(panel).toBeHidden()
    await expect(panel).toBeVisible()
    await page.mouse.move(500, viewport.height / 2)
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

    await expect(page).not.toHaveURL(new RegExp(`ws=${sourceId}(?:&|$)`), { timeout: 20_000 })
    await expect(getWindowGroups(page)).toHaveCount(1)
    await expect(panel).toBeHidden()
    await context.close()
  })

  test('creates and lists a workspace after one-second dwell without rolling back', async ({
    browser,
  }) => {
    const context = await createWorkspaceE2EContext(browser)
    const page = await context.newPage()
    const sourceId = `dwell-new-${Date.now()}`
    await page.goto(`/workspace?ws=${sourceId}`)
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

    await expect(page).not.toHaveURL(new RegExp(`ws=${sourceId}(?:&|$)`), { timeout: 20_000 })
    await expect(
      panel.locator('[data-workspace-id]:not([data-workspace-id="__new__"])'),
    ).toHaveCount(rowsBefore + 1)
    await expect(panel.getByText(/^Workspace \d+$/).last()).toBeVisible()
    const destinationUrl = page.url()
    await page.mouse.up()
    await page.waitForTimeout(500)
    expect(page.url()).toBe(destinationUrl)
    await expect(getWindowGroups(page)).toHaveCount(1)
    await context.close()
  })

  test('rebases local edits onto a newer server snapshot after revision conflict', async ({
    page,
  }) => {
    const id = `conflict-${Date.now()}`
    await page.goto(`/workspace?ws=${id}`)
    await expect(getWindowGroups(page)).toHaveCount(1)
    await expect
      .poll(() =>
        page.evaluate((workspaceId) => localStorage.getItem(`workspace-synced-${workspaceId}`), id),
      )
      .not.toBeNull()

    await page.evaluate(async (workspaceId) => {
      const clientId = sessionStorage.getItem('workspace-client-id')
      const registry = await fetch(
        `/api/workspaces?clientId=${encodeURIComponent(clientId ?? '')}`,
      ).then((response) => response.json())
      const record = registry.records[workspaceId]
      record.snapshot.windows[0].initialState.dir = 'Server/Renamed'
      const response = await fetch('/api/workspaces/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: workspaceId,
          clientId,
          revision: record.revision,
          snapshot: record.snapshot,
        }),
      })
      if (!response.ok) throw new Error(`Server mutation failed: ${response.status}`)
    }, id)

    await page.getByRole('button', { name: 'Open browser window' }).click()
    await expect(getWindowGroups(page)).toHaveCount(2)
    await expect
      .poll(() =>
        page.evaluate(async (workspaceId) => {
          const clientId = sessionStorage.getItem('workspace-client-id')
          const registry = await fetch(
            `/api/workspaces?clientId=${encodeURIComponent(clientId ?? '')}`,
          ).then((response) => response.json())
          const snapshot = registry.records[workspaceId]?.snapshot
          return {
            windows: snapshot?.windows.length,
            repaired: snapshot?.windows.some(
              (window: { initialState?: { dir?: string } }) =>
                window.initialState?.dir === 'Server/Renamed',
            ),
          }
        }, id),
      )
      .toEqual({ windows: 2, repaired: true })
  })
})
