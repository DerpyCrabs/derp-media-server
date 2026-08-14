import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { createWorkspaceE2EContext } from './workspace-e2e-context'

let context: BrowserContext
let page: Page

test.beforeAll(async ({ browser }) => {
  context = await createWorkspaceE2EContext(browser)
})

test.afterAll(async () => {
  await context.close()
})

test.beforeEach(async () => {
  page = await context.newPage()
})

test.afterEach(async () => {
  await page.close()
})

async function seedHermesExplorer(workspaceId: string) {
  await page.addInitScript(
    ({ storageKey }) => {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          windows: [
            {
              id: 'hermes-browser',
              title: 'Hermes Sessions',
              content: {
                schemaVersion: 1,
                codec: 'hermes.content',
                codecVersion: 1,
                payload: {
                  kind: 'explorer',
                  id: 'hermes-browser',
                  location: { provider: 'hermes', id: 'v1:4:root' },
                },
              },
              layout: { bounds: { x: 40, y: 40, width: 700, height: 560 }, zIndex: 1 },
            },
          ],
          activeWindowId: 'hermes-browser',
          activeTabMap: {},
          nextWindowId: 2,
          pinnedTaskbarItems: [],
        }),
      )
    },
    { storageKey: `workspace-state-${workspaceId}` },
  )
}

test('renders parity controls and native export, then archives read-only', async () => {
  let archived = false
  let archiveRequests = 0
  let exportActionRequests = 0
  await page.route('**/api/integrations/hermes/actions', async (route) => {
    const body = route.request().postDataJSON() as {
      action?: string
      key?: { provider?: string; id?: string }
    }
    expect(body).toMatchObject({
      action: 'hermes.download',
      key: { provider: 'hermes', id: 'v1:7:sessionsession-1' },
    })
    exportActionRequests++
    await route.fulfill({
      json: {
        success: true,
        data: { url: '/api/hermes/sessions/session-1/export' },
      },
    })
  })
  await page.route('**/api/hermes/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/messages')) {
      await route.fulfill({
        json: {
          messages: [
            {
              id: 'user-1',
              role: 'user',
              content: '@image:C:\\Hermes\\shot.png\n**Inspect** this\n[screenshot]',
            },
            {
              id: 'assistant-1',
              role: 'assistant',
              content: 'Done',
              reasoning_content: 'Inspecting the supplied image.',
              tool_calls: [
                {
                  id: 'tool-1',
                  function: {
                    name: 'unknown.future_tool',
                    arguments: JSON.stringify({ payload: 'x'.repeat(9_000) }),
                  },
                },
              ],
            },
            {
              id: 'tool-result-1',
              role: 'tool',
              tool_call_id: 'tool-1',
              tool_name: 'unknown.future_tool',
              content: JSON.stringify({ result: 'x'.repeat(9_000) }),
            },
          ],
        },
      })
      return
    }
    if (url.pathname.endsWith('/export')) {
      await route.fulfill({ json: { format: 'hermes-native', session_id: 'session-1' } })
      return
    }
    if (url.pathname === '/api/hermes/media') {
      await route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          'base64',
        ),
      })
      return
    }
    if (url.pathname === '/api/hermes/sessions/session-1') {
      await route.fulfill({ json: { title: 'Hermes E2E', archived, model: 'test-model' } })
      return
    }
    if (url.pathname === '/api/hermes/model-options') {
      await route.fulfill({
        json: {
          provider: 'test-provider',
          model: 'test-model',
          providers: [
            {
              slug: 'test-provider',
              name: 'Test Provider',
              models: ['test-model'],
              capabilities: { 'test-model': { reasoning: true, fast: true } },
            },
          ],
        },
      })
      return
    }
    if (url.pathname === '/api/hermes/capabilities') {
      await route.fulfill({
        json: { compatible: true, transcription: false, playback: false, maxRecordingSeconds: 120 },
      })
      return
    }
    if (url.pathname === '/api/hermes/archive') {
      archiveRequests++
      archived = true
      await route.fulfill({ json: { archived: true } })
      return
    }
    if (url.pathname === '/api/hermes/decision') {
      await route.fulfill({ json: { accepted: true } })
      return
    }
    if (url.pathname === '/api/hermes/events') {
      await route.fulfill({
        contentType: 'text/event-stream',
        body: [
          'data: {"type":"connected"}\n\n',
          'data: {"params":{"durable_session_id":"session-1","type":"approval.request","payload":{"description":"Allow safe action?","choices":["once","deny"]}}}\n\n',
        ].join(''),
      })
      return
    }
    await route.fulfill({ status: 404, json: { error: `Unhandled Hermes mock: ${url.pathname}` } })
  })

  await page.addInitScript(() => {
    localStorage.setItem(
      'workspace-state-ws-hermes-e2e',
      JSON.stringify({
        windows: [
          {
            id: 'hermes-window',
            title: '20260808_212600_f9c4f6',
            content: {
              schemaVersion: 1,
              codec: 'hermes.content',
              codecVersion: 1,
              payload: {
                kind: 'chat',
                id: 'hermes-window',
                sessionId: 'session-1',
                readOnly: false,
              },
            },
            layout: { bounds: { x: 40, y: 40, width: 760, height: 620 }, zIndex: 1 },
          },
        ],
        activeWindowId: 'hermes-window',
        activeTabMap: {},
        nextWindowId: 2,
        pinnedTaskbarItems: [],
      }),
    )
  })
  await page.goto('/workspace?ws=hermes-e2e')

  const chat = page.getByTestId('hermes-chat-pane')
  await expect(chat).toBeVisible()
  await expect(chat.getByText('Inspect this')).toBeVisible()
  await expect(chat.getByText(/@image:/)).toHaveCount(0)
  await expect(chat.getByAltText('Hermes attachment')).toBeVisible()
  expect((await chat.getByAltText('Hermes attachment').boundingBox())!.width).toBeLessThanOrEqual(
    144,
  )
  await chat.getByAltText('Hermes attachment').click()
  const imagePreview = chat.getByRole('dialog', { name: 'Hermes image preview' })
  await expect(imagePreview).toBeVisible()
  const chatBox = (await chat.boundingBox())!
  const previewBox = (await imagePreview.boundingBox())!
  expect(Math.abs(chatBox.width - previewBox.width)).toBeLessThan(1)
  expect(Math.abs(chatBox.height - previewBox.height)).toBeLessThan(1)
  await imagePreview.getByRole('button', { name: 'Close image preview' }).click()
  await expect(chat.locator('.cm-md-strong').filter({ hasText: 'Inspect' })).toBeVisible()
  await expect(page.locator('.workspace-tab-strip').getByText('Hermes E2E')).toBeVisible()
  expect((await chat.getByPlaceholder('Message Hermes…').boundingBox())!.height).toBeLessThan(60)
  expect((await chat.getByTestId('hermes-composer').boundingBox())!.height).toBeLessThan(55)
  await expect(chat.getByTestId('hermes-composer')).toHaveCSS('border-top-left-radius', '10px')
  const composerInputBox = (await chat.getByPlaceholder('Message Hermes…').boundingBox())!
  const sendButtonBox = (await chat.getByRole('button', { name: 'Send' }).boundingBox())!
  expect(
    Math.abs(
      composerInputBox.y +
        composerInputBox.height / 2 -
        (sendButtonBox.y + sendButtonBox.height / 2),
    ),
  ).toBeLessThan(1)
  await expect(chat.getByPlaceholder('Message Hermes…')).toHaveCSS('scrollbar-width', 'none')
  expect(
    await chat
      .getByPlaceholder('Message Hermes…')
      .evaluate((element) => element.scrollHeight <= element.clientHeight),
  ).toBe(true)
  expect(
    await chat.getByTestId('hermes-composer').locator(':scope > div.flex > button').count(),
  ).toBeLessThanOrEqual(3)
  expect(
    (await chat.getByTestId('hermes-tool-card').first().locator('summary').boundingBox())!.height,
  ).toBeLessThan(36)
  await expect(chat.getByTestId('hermes-message-actions').last().locator('summary')).toHaveCSS(
    'opacity',
    '0',
  )
  const transcriptBeforeActions = await chat
    .getByTestId('hermes-transcript')
    .evaluate((element) => ({ scrollHeight: element.scrollHeight, scrollTop: element.scrollTop }))
  await chat.getByTestId('hermes-message-actions').last().locator('summary').click()
  await expect
    .poll(() =>
      chat.getByTestId('hermes-transcript').evaluate((element) => ({
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
      })),
    )
    .toEqual(transcriptBeforeActions)
  const actionsBox = (await chat.getByTestId('hermes-message-actions').last().boundingBox())!
  expect(actionsBox.x).toBeGreaterThanOrEqual(chatBox.x)
  expect(actionsBox.x + actionsBox.width).toBeLessThanOrEqual(chatBox.x + chatBox.width)
  expect(
    await chat
      .getByTestId('hermes-transcript')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true)
  await chat.getByPlaceholder('Message Hermes…').click()
  await expect(chat.getByTestId('hermes-message-actions').last()).not.toHaveAttribute('open', '')
  await expect(chat.getByRole('button', { name: 'Rename' })).toBeHidden()
  await expect(page.locator('.workspace-tab-strip svg.text-violet-500')).toBeVisible()
  await expect(chat.getByText('unknown.future_tool')).toHaveCount(1)
  await chat
    .getByText(/Reasoning/)
    .first()
    .click()
  await chat.getByText('unknown.future_tool').click()
  await expect(chat.getByRole('button', { name: 'Expand full output' })).toBeVisible()
  await chat.getByRole('button', { name: 'Expand full output' }).click()
  await expect(chat.getByRole('button', { name: 'Collapse output' })).toBeVisible()
  await chat.locator('summary[aria-label="Chat options"]').click()
  await expect(chat.getByRole('combobox', { name: 'Hermes model' })).toBeVisible()
  await expect(chat.getByRole('button', { name: 'Toggle Fast mode' })).toBeVisible()
  await chat.locator('summary[aria-label="Chat options"]').click()
  await expect(chat.getByRole('button', { name: 'Record voice prompt' })).toHaveCount(0)
  await expect(chat.getByRole('button', { name: 'Refresh' })).toHaveCount(0)

  await chat.locator('input[type=file]').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Hermes attachment'),
  })
  await expect(chat.getByLabel('Attachments').getByText('notes.txt')).toBeVisible()
  await expect(chat.getByText('Allow safe action?')).toBeVisible()
  await chat.getByRole('button', { name: 'once' }).click()
  await expect(chat.getByText('Allow safe action?')).toHaveCount(0)

  const download = page.waitForEvent('download')
  await chat.locator('summary[aria-label="Chat options"]').click()
  await chat.getByRole('button', { name: 'Export' }).click()
  await expect((await download).suggestedFilename()).toBe('Hermes-E2E.json')
  expect(exportActionRequests).toBe(1)

  await chat.getByRole('button', { name: 'Archive' }).click()
  await expect.poll(() => archiveRequests).toBe(1)
  await expect(chat.getByText('Archived session — read only')).toBeVisible()
  await expect(chat.getByRole('button', { name: 'Restore' })).toBeVisible()
})

test('matches Hermes Desktop optimistic, streaming, and stick-to-bottom behavior', async () => {
  let historyRequests = 0
  let releaseTurn!: () => void
  const turnGate = new Promise<void>((resolve) => {
    releaseTurn = resolve
  })
  await page.route('**/api/hermes/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/messages')) {
      historyRequests++
      await route.fulfill({
        json: {
          messages: [
            ...Array.from({ length: 30 }, (_, index) => ({
              id: `message-${index}`,
              role: 'assistant',
              content: `Transcript row ${index}\n${'content '.repeat(12)}`,
            })),
          ],
        },
      })
      return
    }
    if (url.pathname === '/api/hermes/sessions/session-stable') {
      await route.fulfill({ json: { title: 'Stable session', archived: false } })
      return
    }
    if (url.pathname === '/api/hermes/capabilities') {
      await route.fulfill({ json: { compatible: true, transcription: false, playback: false } })
      return
    }
    if (url.pathname === '/api/hermes/model-options') {
      await route.fulfill({ json: { providers: [] } })
      return
    }
    if (url.pathname === '/api/hermes/turn') {
      await turnGate
      await route.fulfill({ json: { sessionId: 'session-stable', accepted: true } })
      return
    }
    await route.fulfill({ status: 404, json: { error: `Unhandled Hermes mock: ${url.pathname}` } })
  })
  await page.addInitScript(() => {
    class ControlledEventSource {
      onopen: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      onerror: (() => void) | null = null
      constructor() {
        ;(window as any).__emitHermesEvent = (value: unknown) =>
          this.onmessage?.({ data: JSON.stringify(value) })
        ;(window as any).__reopenHermesEvents = () => this.onopen?.()
        queueMicrotask(() => this.onopen?.())
      }
      close() {}
    }
    Object.defineProperty(window, 'EventSource', {
      configurable: true,
      value: ControlledEventSource,
    })
    localStorage.setItem(
      'workspace-state-ws-hermes-stable',
      JSON.stringify({
        windows: [
          {
            id: 'hermes-stable',
            title: 'session-stable',
            content: {
              schemaVersion: 1,
              codec: 'hermes.content',
              codecVersion: 1,
              payload: {
                kind: 'chat',
                id: 'hermes-stable',
                sessionId: 'session-stable',
                readOnly: false,
              },
            },
            layout: { bounds: { x: 20, y: 20, width: 680, height: 520 }, zIndex: 1 },
          },
        ],
        activeWindowId: 'hermes-stable',
        activeTabMap: {},
        nextWindowId: 2,
        pinnedTaskbarItems: [],
      }),
    )
  })
  await page.goto('/workspace?ws=hermes-stable')
  const chat = page.getByTestId('hermes-chat-pane')
  const transcript = chat.getByTestId('hermes-transcript')
  await expect(chat.getByText('Transcript row 29')).toBeVisible()
  const initialHistoryRequests = historyRequests
  await transcript.evaluate((element) => {
    let mutations = 0
    const observer = new MutationObserver((records) => {
      mutations += records.length
    })
    observer.observe(element, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    })
    ;(window as any).__hermesTranscriptMutations = () => mutations
    ;(window as any).__stopHermesTranscriptObserver = () => observer.disconnect()
  })
  await page.evaluate(() => (window as any).__reopenHermesEvents())
  await expect.poll(() => historyRequests).toBeGreaterThan(initialHistoryRequests)
  await page.waitForTimeout(100)
  expect(await page.evaluate(() => (window as any).__hermesTranscriptMutations())).toBe(0)
  await page.evaluate(() => (window as any).__stopHermesTranscriptObserver())
  const historyRequestsAfterRefresh = historyRequests
  const composer = chat.getByPlaceholder('Message Hermes…')
  await composer.fill('Immediate optimistic prompt')
  await chat.getByRole('button', { name: 'Send' }).click()
  await expect(chat.getByText('Immediate optimistic prompt', { exact: true })).toBeVisible()
  await expect(chat.getByTestId('hermes-awaiting-response')).toBeVisible()

  await page.evaluate(() =>
    (window as any).__emitHermesEvent({
      params: {
        durable_session_id: 'session-rotated',
        previous_durable_session_id: 'session-stable',
        type: 'session.info',
        payload: { running: true },
      },
    }),
  )
  releaseTurn()
  const emit = (type: string, payload: Record<string, unknown> = {}) =>
    page.evaluate(
      ({ type, payload }) =>
        (window as any).__emitHermesEvent({
          params: { durable_session_id: 'session-rotated', type, payload },
        }),
      { type, payload },
    )
  await emit('message.start')
  await expect(chat.getByTestId('hermes-awaiting-response')).toBeVisible()
  await emit('session.info', { running: true })
  await emit('message.delta', { text: 'First streamed chunk' })
  const streamMessage = chat.locator('[id^="hermes-msg-assistant-stream-"]')
  await expect(streamMessage).toContainText('First streamed chunk')
  await expect(streamMessage.getByLabel('Hermes is working')).toBeVisible()
  await streamMessage.evaluate((element) => {
    ;(window as any).__stableHermesStreamNode = element
  })

  await transcript.dispatchEvent('wheel', { deltaY: -100 })
  await transcript.evaluate((element) => {
    element.scrollTop = 0
  })
  const jumpToLatest = chat.getByRole('button', { name: 'Jump to latest message' })
  await expect(jumpToLatest).toBeVisible()
  expect(await transcript.evaluate((element) => element.scrollTop)).toBeLessThan(3)
  await emit('tool.start', {
    tool_id: 'tool-1',
    name: 'vision_analyze',
    args: { path: 'image.png' },
  })
  await emit('tool.complete', { tool_id: 'tool-1', name: 'vision_analyze', result: { ok: true } })
  await expect.poll(() => transcript.evaluate((element) => element.scrollTop)).toBeLessThan(3)
  expect(
    await streamMessage.evaluate((element) => element === (window as any).__stableHermesStreamNode),
  ).toBe(true)

  await transcript.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect(jumpToLatest).toHaveCount(0)
  await emit('message.delta', { text: ' and more text' })
  await expect(streamMessage).toContainText('First streamed chunk and more text')
  await expect
    .poll(() =>
      transcript.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThan(3)
  await emit('session.info', { running: true })
  await emit('message.complete', { text: 'Final streamed answer' })
  await expect(streamMessage).toContainText('Final streamed answer')
  await expect(streamMessage.getByLabel('Hermes is working')).toHaveCount(0)
  await expect(chat.getByText('Immediate optimistic prompt', { exact: true })).toBeVisible()
  expect(historyRequests).toBe(historyRequestsAfterRefresh)

  await expect
    .poll(() =>
      page.evaluate(() => {
        const saved = JSON.parse(localStorage.getItem('workspace-state-ws-hermes-stable') ?? 'null')
        return saved?.windows?.[0]?.content?.payload?.sessionId
      }),
    )
    .toBe('session-rotated')
})

test('pages older history and opens externally active sessions in observer mode', async () => {
  const offsets: string[] = []
  await page.route('**/api/hermes/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/messages')) {
      offsets.push(url.searchParams.get('offset') ?? '')
      const offset = Number(url.searchParams.get('offset'))
      await route.fulfill({
        json: {
          data:
            offset === 0
              ? Array.from({ length: 100 }, (_, index) => ({
                  id: `recent-${index}`,
                  role: 'assistant',
                  content: `Recent ${index}`,
                }))
              : [{ id: 'oldest', role: 'user', content: 'Oldest paged message' }],
        },
      })
      return
    }
    if (url.pathname === '/api/hermes/sessions/session-paged') {
      await route.fulfill({
        json: {
          title: 'Paged session',
          archived: false,
          externallyActive: true,
          source: 'desktop',
        },
      })
      return
    }
    if (url.pathname === '/api/hermes/capabilities') {
      await route.fulfill({ json: { compatible: true, transcription: false, playback: false } })
      return
    }
    if (url.pathname === '/api/hermes/model-options') {
      await route.fulfill({ json: { providers: [] } })
      return
    }
    if (url.pathname === '/api/hermes/events') {
      await route.fulfill({
        contentType: 'text/event-stream',
        body: 'data: {"type":"connected"}\n\n',
      })
      return
    }
    await route.fulfill({ status: 404, json: { error: `Unhandled Hermes mock: ${url.pathname}` } })
  })
  await page.addInitScript(() => {
    localStorage.setItem(
      'workspace-state-ws-hermes-paging',
      JSON.stringify({
        windows: [
          {
            id: 'hermes-paged',
            title: 'session-paged',
            content: {
              schemaVersion: 1,
              codec: 'hermes.content',
              codecVersion: 1,
              payload: {
                kind: 'chat',
                id: 'hermes-paged',
                sessionId: 'session-paged',
                readOnly: false,
              },
            },
            layout: { bounds: { x: 20, y: 20, width: 760, height: 620 }, zIndex: 1 },
          },
        ],
        activeWindowId: 'hermes-paged',
        activeTabMap: {},
        nextWindowId: 2,
        pinnedTaskbarItems: [],
      }),
    )
  })
  await page.goto('/workspace?ws=hermes-paging')
  const chat = page.getByTestId('hermes-chat-pane')
  await expect(chat.getByText('Active in desktop — observer mode')).toBeVisible()
  await expect(chat.getByRole('button', { name: 'Take over' })).toBeVisible()
  await expect(chat.getByText('Oldest paged message')).toHaveCount(0)
  await chat.getByRole('button', { name: 'Load older messages' }).click()
  await expect(chat.getByText('Oldest paged message')).toBeVisible()
  expect(offsets).toContain('100')
  await expect(chat.getByRole('button', { name: 'Load older messages' })).toHaveCount(0)
  await chat.getByRole('button', { name: 'Take over' }).click()
  await expect(chat.getByPlaceholder('Message Hermes…')).toBeEnabled()
})

test('keeps the Hermes project dialog compact inside its browser window', async () => {
  await seedHermesExplorer('ws-hermes-project-dialog')
  await page.route('**/api/integrations/hermes/browse?*', async (route) => {
    await route.fulfill({
      json: {
        schemaVersion: 1,
        location: { provider: 'hermes', id: 'v1:4:root' },
        locationSummary: {
          key: { provider: 'hermes', id: 'v1:4:root' },
          name: 'Hermes Sessions',
          kind: 'hermes-root',
          capabilities: ['browse', 'hermes.createFile', 'hermes.createFolder'],
          presentation: 'browse',
        },
        breadcrumbs: [],
        items: [],
        total: 0,
      },
    })
  })
  await page.goto('/workspace?ws=hermes-project-dialog')
  await page.locator('button[title="Create new project"]').click()
  const dialog = page.getByRole('dialog', { name: 'Create Hermes project' })
  await expect(dialog).toBeVisible()
  const browser = dialog.locator(
    'xpath=ancestor::div[contains(@class,"workspace-window-content")][1]',
  )
  const browserBox = (await browser.boundingBox())!
  const dialogBox = (await dialog.boundingBox())!
  expect(dialogBox.height).toBeLessThan(360)
  expect(dialogBox.y).toBeGreaterThanOrEqual(browserBox.y)
  expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(browserBox.y + browserBox.height)
  await expect(dialog.getByText('Additional directories')).toBeVisible()
  await expect(dialog.locator('textarea')).toBeHidden()
})

test('uses in-window Hermes project actions with gateway-backed choices', async () => {
  await seedHermesExplorer('ws-hermes-actions')
  const actions: Array<Record<string, unknown>> = []
  const items = [
    {
      key: { provider: 'hermes', id: 'v1:7:projectproject-a' },
      name: 'Project Alpha',
      kind: 'hermes-project',
      capabilities: [
        'browse',
        'hermes.open',
        'hermes.addProjectFolder',
        'hermes.removeProjectFolder',
        'hermes.setPrimaryFolder',
        'hermes.setAppearance',
      ],
      presentation: 'browse',
      appearance: { icon: 'Folder', tone: 'indigo' },
      metadata: {
        primary_path: 'C:/work/alpha',
        folders: [{ path: 'C:/work/alpha', is_primary: true }],
      },
    },
    {
      key: { provider: 'hermes', id: 'v1:7:sessionsession-loose' },
      name: 'Loose session',
      kind: 'hermes-session',
      capabilities: ['read', 'hermes.open', 'hermes.moveToProject'],
      presentation: 'hermes-session',
      appearance: { icon: 'agent-session', tone: 'violet' },
    },
  ]
  await page.route('**/api/integrations/hermes/browse?*', async (route) => {
    await route.fulfill({
      json: {
        schemaVersion: 1,
        location: { provider: 'hermes', id: 'v1:4:root' },
        locationSummary: {
          key: { provider: 'hermes', id: 'v1:4:root' },
          name: 'Hermes Sessions',
          kind: 'hermes-root',
          capabilities: ['browse', 'hermes.createFile', 'hermes.createFolder'],
          presentation: 'browse',
        },
        breadcrumbs: [],
        items,
        total: items.length,
      },
    })
  })
  await page.route('**/api/integrations/hermes/actions', async (route) => {
    actions.push(route.request().postDataJSON())
    await route.fulfill({ json: { success: true } })
  })
  await page.goto('/workspace?ws=hermes-actions')

  await page.getByText('Loose session', { exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Move to project/ }).click()
  const moveDialog = page.getByRole('dialog', { name: 'Move to Hermes project' })
  await expect(moveDialog).toBeVisible()
  await expect(moveDialog.getByRole('combobox')).toHaveValue('Project Alpha')
  await moveDialog.getByRole('button', { name: 'Move' }).click()
  await expect.poll(() => actions.length).toBe(1)
  expect(actions[0]).toMatchObject({ action: 'hermes.moveToProject', name: 'Project Alpha' })
  await expect(moveDialog).toBeHidden()

  await page
    .getByRole('rowgroup')
    .getByText('Project Alpha', { exact: true })
    .click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Set appearance' }).click()
  const appearanceDialog = page.getByRole('dialog', { name: 'Project appearance' })
  await expect(appearanceDialog).toBeVisible()
  await appearanceDialog.getByRole('button', { name: 'Star' }).click()
  await appearanceDialog.getByRole('button', { name: 'Save' }).click()
  await expect.poll(() => actions.length).toBe(2)
  expect(actions[1]).toMatchObject({
    action: 'hermes.setAppearance',
    metadata: { icon: 'Star' },
  })
})
