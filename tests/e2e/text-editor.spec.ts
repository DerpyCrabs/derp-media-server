import { test, expect, type APIRequestContext, type Page } from '@playwright/test'

const TODO_PATH = 'Notes/markdown-editor-e2e.md'
const TODO_SOURCE = '# Todo List\n\n- [ ] First task\n- [ ] Second task\n- [x] Done task\n'
const AUTOSAVE_PATH = 'Notes/autosave-parity.txt'
const AUTOSAVE_SOURCE = 'Autosave parity initial content for e2e only.\n'
const LARGE_MARKDOWN_OPEN_THRESHOLD_MS = 10_000
const LARGE_MARKDOWN_INTERACTION_THRESHOLD_MS = 3_000

function markdownDocument(page: Page, mode: 'read' | 'edit') {
  return page.locator(`[data-testid="markdown-document"][data-mode="${mode}"]`)
}

function markdownEditor(page: Page) {
  return markdownDocument(page, 'edit').getByRole('textbox')
}

async function writeFile(request: APIRequestContext, path: string, content: string) {
  const response = await request.post('/api/files/edit', {
    data: { path, content },
  })
  expect(response.ok()).toBe(true)
}

async function createFile(request: APIRequestContext, path: string, content: string) {
  const response = await request.post('/api/files/create', {
    data: { path, content },
  })
  expect(response.ok()).toBe(true)
}

async function readFile(request: APIRequestContext, path: string) {
  const response = await request.get(`/api/media/${path}`)
  expect(response.ok()).toBe(true)
  return response.text()
}

async function replaceMarkdown(page: Page, content: string) {
  const editor = markdownEditor(page)
  await editor.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText(content)
}

async function saveMarkdown(page: Page) {
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes('/api/files/edit') && response.status() === 200,
    ),
    page.getByRole('button', { name: 'Save', exact: true }).click(),
  ])
}

async function dispatchPaste(page: Page, data: { html?: string; plain?: string }) {
  await markdownEditor(page).evaluate((element, clipboard) => {
    const transfer = new DataTransfer()
    if (clipboard.html !== undefined) transfer.setData('text/html', clipboard.html)
    if (clipboard.plain !== undefined) transfer.setData('text/plain', clipboard.plain)
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }),
    )
  }, data)
}

test.describe('Text Editor', () => {
  test.beforeEach(async ({ request }) => {
    await writeFile(request, TODO_PATH, TODO_SOURCE)
    await writeFile(request, AUTOSAVE_PATH, AUTOSAVE_SOURCE)

    for (const filePath of [TODO_PATH, AUTOSAVE_PATH]) {
      const response = await request.post('/api/settings/autoSave', {
        data: {
          filePath,
          enabled: filePath === AUTOSAVE_PATH,
          readOnly: false,
        },
      })
      expect(response.ok()).toBe(true)
    }
  })

  test('opens text viewer when clicking a text file', async ({ page }) => {
    await page.goto('/?dir=Documents')
    await page.locator('table').getByText('readme.txt').click()
    await page.waitForURL(/viewing=/)
    await expect(page.getByTestId('text-viewer-content')).toBeVisible()
    await expect(page.getByText('This is a test readme file')).toBeVisible()
  })

  test('opens Markdown editor and switches between read and edit modes', async ({ page }) => {
    await page.goto(`/?dir=Notes&viewing=${encodeURIComponent(AUTOSAVE_PATH)}`)
    await expect(page.locator('textarea')).toBeVisible()

    await page.locator('button[title="Close"]').click()
    const markdownRow = page.locator('table').getByText('markdown-editor-e2e.md', { exact: true })
    await expect(markdownRow).toBeVisible()
    await markdownRow.click()

    await expect(markdownEditor(page)).toBeVisible()

    await page.getByRole('button', { name: 'Read only' }).click()
    await expect(markdownDocument(page, 'read').getByRole('document')).toBeVisible()
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(markdownEditor(page)).toBeVisible()
  })

  test('resets Markdown history when switching equal-content files', async ({
    page,
    request,
  }, testInfo) => {
    const unique = `${testInfo.workerIndex}-${Date.now()}`
    const firstPath = `Notes/history-first-${unique}.md`
    const secondPath = `Notes/history-second-${unique}.md`
    const source = 'identical content'

    await createFile(request, firstPath, source)
    await createFile(request, secondPath, source)

    try {
      for (const filePath of [firstPath, secondPath]) {
        const settingsResponse = await request.post('/api/settings/autoSave', {
          data: { filePath, enabled: false, readOnly: false },
        })
        expect(settingsResponse.ok()).toBe(true)
      }

      await page.goto(`/?dir=Notes&viewing=${encodeURIComponent(secondPath)}`)
      await expect(markdownEditor(page)).toHaveAttribute(
        'aria-label',
        `${secondPath.split('/').at(-1)} Markdown editor`,
      )

      await page.evaluate((filePath) => {
        const url = new URL(window.location.href)
        url.searchParams.set('viewing', filePath)
        window.history.pushState(null, '', url)
      }, firstPath)
      const firstEditor = markdownEditor(page)
      await expect(firstEditor).toHaveAttribute(
        'aria-label',
        `${firstPath.split('/').at(-1)} Markdown editor`,
      )
      await firstEditor.fill('different content')
      await page.waitForTimeout(600)
      await firstEditor.fill(source)

      await page.evaluate((filePath) => {
        const url = new URL(window.location.href)
        url.searchParams.set('viewing', filePath)
        window.history.pushState(null, '', url)
      }, secondPath)
      const secondEditor = markdownEditor(page)
      await expect(secondEditor).toHaveAttribute(
        'aria-label',
        `${secondPath.split('/').at(-1)} Markdown editor`,
      )
      await secondEditor.focus()
      await page.keyboard.press('Control+z')

      await expect(secondEditor).toHaveText(source)
      expect(await readFile(request, secondPath)).toBe(source)
    } finally {
      for (const filePath of [firstPath, secondPath]) {
        await request.post('/api/files/delete', { data: { path: filePath } }).catch(() => {})
      }
    }
  })

  test('renders Markdown read mode with CodeMirror live-preview decorations', async ({
    page,
    request,
  }) => {
    const source = [
      '# Read Fixture',
      '',
      'line one',
      'line two with **bold**, *italic*, and ~~strike~~.',
      '',
      '- bullet',
      '  - nested bullet',
      '1. ordered',
      '',
      '- [ ] open task',
      '',
      '[link](https://example.com) and <https://autolink.example>',
      '',
      '> quoted text',
      '',
      '---',
      '',
      '`inline code`',
      '',
      '```js',
      'const answer = 42',
      '```',
      '',
      '| Name | Value |',
      '| --- | --- |',
      '| one | two |',
      '',
      '<span>literal HTML</span>',
      '',
      '**unfinished and @@ unknown source',
      '',
    ].join('\n')
    await writeFile(request, TODO_PATH, source)
    const settingsResponse = await request.post('/api/settings/autoSave', {
      data: { filePath: TODO_PATH, enabled: false, readOnly: true },
    })
    expect(settingsResponse.ok()).toBe(true)

    await page.goto(`/?dir=Notes&viewing=${encodeURIComponent(TODO_PATH)}`)
    const document = markdownDocument(page, 'read')
    const reader = document.getByRole('document', {
      name: 'markdown-editor-e2e.md Markdown document',
    })

    await expect(reader).toHaveAttribute('contenteditable', 'false')
    await expect(document.locator('.cm-md-heading-1')).toContainText('Read Fixture')
    await expect(document.locator('.cm-md-strong')).toContainText('bold')
    await expect(document.locator('.cm-md-emphasis')).toContainText('italic')
    await expect(document.locator('.cm-md-strikethrough')).toContainText('strike')
    await expect(document.locator('.cm-md-list-marker')).toHaveCount(4)
    await expect(document.getByRole('checkbox', { name: 'Open task' })).toBeDisabled()
    await expect(document.locator('[data-markdown-link="https://example.com"]')).toBeVisible()
    await expect(document.locator('[data-markdown-link="https://autolink.example"]')).toBeVisible()
    await expect(document.locator('.cm-md-blockquote-line')).toContainText('quoted text')
    await expect(document.locator('.cm-md-horizontal-rule')).toBeVisible()
    await expect(document.locator('.cm-md-inline-code')).toContainText('inline code')
    expect(await document.locator('.cm-md-code-block-line').count()).toBeGreaterThanOrEqual(3)
    await expect(document.locator('.cm-md-table-header')).toContainText('Name')
    expect(await document.locator('.cm-md-inert-html').count()).toBeGreaterThanOrEqual(2)
    await expect(reader).toContainText('literal HTML')
    await expect(reader).toContainText('**unfinished and @@ unknown source')
    await expect(document.locator('.cm-line').filter({ hasText: 'line one' })).toBeVisible()
    await expect(document.locator('.cm-line').filter({ hasText: 'line two' })).toBeVisible()
    await expect(document.locator('.cm-gutters')).toHaveCount(0)

    await reader.click()
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('Shift+End')
    const copied = await reader.evaluate((element) => {
      const transfer = new DataTransfer()
      element.dispatchEvent(
        new ClipboardEvent('copy', {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer,
        }),
      )
      return transfer.getData('text/plain')
    })
    expect(copied).toBe('# Read Fixture')
  })

  test('markdown image click opens fullscreen overlay', async ({ page }) => {
    await page.goto(`/?dir=Documents&viewing=${encodeURIComponent('Documents/image-note.md')}`)
    const img = markdownDocument(page, 'read').locator('img.cm-md-image[alt="photo"]')
    await expect(img).toBeVisible()
    await img.click()
    const overlay = page.locator('[role="dialog"][aria-label="View image fullscreen"]')
    await expect(overlay).toBeVisible()
  })

  test('does not show edit button for non-editable folders', async ({ page }) => {
    await page.goto(`/?dir=Documents&viewing=${encodeURIComponent('Documents/readme.txt')}`)
    await expect(page.getByText('This is a test readme file')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).not.toBeVisible()
  })

  test('auto-enters Markdown edit mode and preserves one editor across mode switches', async ({
    page,
  }) => {
    await page.goto(`/?dir=Notes&viewing=${encodeURIComponent(TODO_PATH)}`)
    const editDocument = markdownDocument(page, 'edit')
    const editor = markdownEditor(page)

    await expect(editor).toBeVisible()
    await expect(editor).toHaveAttribute('contenteditable', 'true')
    await expect(page.locator('textarea')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Read only' })).toBeVisible()
    await expect(editDocument.locator('.cm-line').first()).toContainText('Todo List')
    await editDocument.locator('.cm-editor').evaluate((element) => {
      element.setAttribute('data-e2e-editor-instance', 'preserved')
    })
    await editor.click()
    expect(
      await editDocument
        .locator('.cm-editor')
        .evaluate((element) => getComputedStyle(element).outlineStyle),
    ).toBe('none')
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('\nunsaved mode probe')

    await page.getByRole('button', { name: 'Read only' }).click()
    const readDocument = markdownDocument(page, 'read')
    await expect(
      readDocument.getByRole('document', { name: 'markdown-editor-e2e.md Markdown document' }),
    ).toBeVisible()
    await expect(readDocument.locator('[data-e2e-editor-instance="preserved"]')).toBeVisible()
    await expect(readDocument.locator('.cm-md-heading-1')).toContainText('Todo List')
    await expect(readDocument).toContainText('unsaved mode probe')

    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(markdownEditor(page)).toBeVisible()
    await expect(
      markdownDocument(page, 'edit').locator('[data-e2e-editor-instance="preserved"]'),
    ).toBeVisible()
    await expect(markdownDocument(page, 'edit').locator('.cm-line').first()).toContainText(
      'Todo List',
    )
    await markdownEditor(page).focus()
    await page.keyboard.press('Control+z')
    await expect(markdownDocument(page, 'edit')).not.toContainText('unsaved mode probe')
  })

  test('uses CodeMirror for editable Markdown outside a knowledge base', async ({
    page,
    request,
  }, testInfo) => {
    const path = `MediaContent/outside-kb-${testInfo.workerIndex}-${Date.now()}.md`
    const initial = '# Outside KB\n\nEditable Markdown file.\n'
    const updated = '# Outside KB Updated\n\nSaved through CodeMirror.\n'
    await createFile(request, path, initial)
    const settingsResponse = await request.post('/api/settings/autoSave', {
      data: { filePath: path, enabled: false, readOnly: false },
    })
    expect(settingsResponse.ok()).toBe(true)

    await page.goto(`/?dir=MediaContent&viewing=${encodeURIComponent(path)}`)
    const document = markdownDocument(page, 'edit')
    await expect(document.getByRole('textbox')).toBeVisible()
    await expect(document.locator('.cm-md-heading-1')).toContainText('Outside KB')
    await expect(page.locator('textarea')).toHaveCount(0)

    await replaceMarkdown(page, updated)
    await saveMarkdown(page)
    expect(await readFile(request, path)).toBe(updated)
  })

  test('keeps a representative 1 MB Markdown document responsive', async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(120_000)
    const path = `MediaContent/large-markdown-${testInfo.workerIndex}-${Date.now()}.md`
    const fillerLine = `${'representative Markdown prose '.repeat(4)}\n`
    const fixedSource = [
      '# Large Markdown Fixture',
      'TOP_MARKER',
      '',
      'MIDDLE_MARKER',
      '- [ ] LARGE_TASK',
      '',
      'END_MARKER',
    ].join('\n')
    const fixtureTargetBytes = 1_000_000
    const fillerCount = Math.ceil((fixtureTargetBytes - fixedSource.length) / fillerLine.length / 2)
    const filler = fillerLine.repeat(fillerCount)
    const source = [
      '# Large Markdown Fixture\nTOP_MARKER\n',
      filler,
      'MIDDLE_MARKER\n- [ ] LARGE_TASK\n',
      filler,
      'END_MARKER',
    ].join('')
    expect(new TextEncoder().encode(source).byteLength).toBeGreaterThanOrEqual(fixtureTargetBytes)

    const timings: Record<string, number> = {}
    const timed = async (name: string, threshold: number, operation: () => Promise<void>) => {
      const started = Date.now()
      await operation()
      timings[name] = Date.now() - started
      expect(timings[name], `${name} took ${timings[name]} ms`).toBeLessThan(threshold)
    }

    try {
      await createFile(request, path, source)
      const settingsResponse = await request.post('/api/settings/autoSave', {
        data: { filePath: path, enabled: false, readOnly: false },
      })
      expect(settingsResponse.ok()).toBe(true)

      await timed('initial open', LARGE_MARKDOWN_OPEN_THRESHOLD_MS, async () => {
        await page.goto(`/?dir=MediaContent&viewing=${encodeURIComponent(path)}`)
        await expect(markdownEditor(page)).toBeVisible()
        await expect(markdownDocument(page, 'edit').locator('.cm-line').first()).toContainText(
          'Large Markdown Fixture',
        )
      })

      const document = markdownDocument(page, 'edit')
      const editor = markdownEditor(page)
      const scroll = document.locator('.cm-scroller')
      await document.locator('.cm-editor').evaluate((element) => {
        element.setAttribute('data-e2e-large-editor-instance', 'preserved')
      })

      await timed('type at top', LARGE_MARKDOWN_INTERACTION_THRESHOLD_MS, async () => {
        await editor.focus()
        await page.keyboard.press('Control+Home')
        await page.keyboard.insertText('TOP_EDIT\n')
        await expect(document.locator('.cm-line').first()).toContainText('TOP_EDIT')
      })

      await timed(
        'scroll and type at middle',
        LARGE_MARKDOWN_INTERACTION_THRESHOLD_MS,
        async () => {
          const scrollPosition = await scroll.evaluate((element) => {
            element.scrollTop = (element.scrollHeight - element.clientHeight) / 2
            element.dispatchEvent(new Event('scroll'))
            return element.scrollTop
          })
          expect(scrollPosition).toBeGreaterThan(0)
          const middle = document.locator('.cm-line').filter({ hasText: 'MIDDLE_MARKER' })
          await expect(middle).toBeVisible()
          await middle.click()
          await page.keyboard.press('End')
          await page.keyboard.insertText(' MIDDLE_EDIT')
          await expect(middle).toContainText('MIDDLE_MARKER MIDDLE_EDIT')
        },
      )

      await timed('toggle task', LARGE_MARKDOWN_INTERACTION_THRESHOLD_MS, async () => {
        const task = document.locator('.cm-md-task-checkbox')
        await expect(task).toBeVisible()
        await task.click()
        await expect(task).toBeChecked()
      })

      await timed(
        'switch read and edit modes',
        LARGE_MARKDOWN_INTERACTION_THRESHOLD_MS,
        async () => {
          await page.getByRole('button', { name: 'Read only' }).click()
          const readDocument = markdownDocument(page, 'read')
          await expect(readDocument.getByRole('document')).toBeVisible()
          await expect(readDocument).toContainText('MIDDLE_MARKER MIDDLE_EDIT')
          await expect(
            readDocument.locator('[data-e2e-large-editor-instance="preserved"]'),
          ).toBeVisible()
          await page.getByRole('button', { name: 'Edit', exact: true }).click()
          await expect(markdownEditor(page)).toBeVisible()
          await expect(
            markdownDocument(page, 'edit').locator('[data-e2e-large-editor-instance="preserved"]'),
          ).toBeVisible()
        },
      )

      await timed('scroll and type at end', LARGE_MARKDOWN_INTERACTION_THRESHOLD_MS, async () => {
        await markdownEditor(page).focus()
        await page.keyboard.press('Control+End')
        await page.keyboard.insertText(' END_EDIT')
        const end = markdownDocument(page, 'edit').locator('.cm-line').filter({
          hasText: 'END_MARKER END_EDIT',
        })
        await expect(end).toBeVisible()
        const scrollPosition = await scroll.evaluate((element) => element.scrollTop)
        expect(scrollPosition).toBeGreaterThan(0)
      })

      await saveMarkdown(page)
      const expected = `TOP_EDIT\n${source}`
        .replace('MIDDLE_MARKER', 'MIDDLE_MARKER MIDDLE_EDIT')
        .replace('- [ ] LARGE_TASK', '- [x] LARGE_TASK')
        .replace('END_MARKER', 'END_MARKER END_EDIT')
      expect(await readFile(request, path)).toBe(expected)
    } finally {
      await testInfo.attach('large-markdown-timings.json', {
        body: JSON.stringify(
          {
            thresholdsMs: {
              initialOpen: LARGE_MARKDOWN_OPEN_THRESHOLD_MS,
              interaction: LARGE_MARKDOWN_INTERACTION_THRESHOLD_MS,
            },
            measuredMs: timings,
          },
          null,
          2,
        ),
        contentType: 'application/json',
      })
      await request.post('/api/files/delete', { data: { path } }).catch(() => {})
    }
  })

  test('reveals active Markdown syntax without changing source', async ({ page, request }) => {
    let editRequests = 0
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/api/files/edit')) editRequests += 1
    })
    await page.goto(`/?dir=Notes&viewing=${encodeURIComponent(TODO_PATH)}`)
    const editor = markdownEditor(page)
    const heading = markdownDocument(page, 'edit').locator('.cm-line').first()

    await editor.click()
    await page.keyboard.press('Control+End')
    await expect(heading).toHaveText('Todo List')

    await heading.click()
    await expect(heading).toContainText('# Todo List')

    await page.keyboard.press('Control+End')
    await expect(heading).toHaveText('Todo List')
    expect(await readFile(request, TODO_PATH)).toBe(TODO_SOURCE)
    expect(editRequests).toBe(0)
  })

  test('keeps CodeMirror cursor position while typing within existing text', async ({
    page,
    request,
  }) => {
    await page.goto(`/?dir=Notes&viewing=${encodeURIComponent(TODO_PATH)}`)
    const editor = markdownEditor(page)
    await editor.click()
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.type('abcde')
    await saveMarkdown(page)

    expect(await readFile(request, TODO_PATH)).toBe(
      '# abcdeTodo List\n\n- [ ] First task\n- [ ] Second task\n- [x] Done task\n',
    )
  })

  test('bold and italic shortcuts wrap and toggle selections', async ({ page, request }) => {
    await writeFile(request, TODO_PATH, 'alpha beta\n')
    await page.goto(`/?dir=Notes&viewing=${encodeURIComponent(TODO_PATH)}`)
    const editor = markdownEditor(page)
    const line = markdownDocument(page, 'edit').locator('.cm-line').first()

    await editor.click()
    await page.keyboard.press('Control+Home')
    for (let index = 0; index < 5; index += 1) await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Control+b')
    await expect(line).toContainText('**alpha** beta')
    await page.keyboard.press('Control+b')
    await expect(line).toHaveText('alpha beta')
    await page.keyboard.press('Control+b')

    await line.click()
    await page.keyboard.press('End')
    for (let index = 0; index < 4; index += 1) await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Control+i')
    await expect(markdownDocument(page, 'edit').locator('.cm-md-strong')).toContainText('alpha')
    await expect(line).toContainText('*beta*')
    await saveMarkdown(page)

    expect(await readFile(request, TODO_PATH)).toBe('**alpha** *beta*\n')
  })

  test('continues bullet, ordered, and task lists and indents only list items', async ({
    page,
    request,
  }) => {
    await writeFile(request, TODO_PATH, '- bullet\n1. ordered\n- [ ] task\n\noutside\n')
    await page.goto(`/?dir=Notes&viewing=${encodeURIComponent(TODO_PATH)}`)
    const document = markdownDocument(page, 'edit')

    await document.locator('.cm-line').filter({ hasText: 'bullet' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('continued bullet')

    await document.locator('.cm-line').filter({ hasText: 'ordered' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('continued ordered')

    await document.locator('.cm-line').filter({ hasText: 'task' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('continued task')

    const continuedBullet = document.locator('.cm-line').filter({ hasText: 'continued bullet' })
    await continuedBullet.click()
    await page.keyboard.press('Tab')
    await saveMarkdown(page)
    expect(await readFile(request, TODO_PATH)).toContain('\n  - continued bullet\n')

    await continuedBullet.click()
    await page.keyboard.press('Shift+Tab')
    await saveMarkdown(page)
    expect(await readFile(request, TODO_PATH)).toBe(
      '- bullet\n- continued bullet\n1. ordered\n2. continued ordered\n- [ ] task\n- [ ] continued task\n\noutside\n',
    )

    await document.locator('.cm-line').filter({ hasText: 'outside' }).click()
    await page.keyboard.press('Tab')
    await expect(markdownEditor(page)).not.toBeFocused()
    expect(await readFile(request, TODO_PATH)).toBe(
      '- bullet\n- continued bullet\n1. ordered\n2. continued ordered\n- [ ] task\n- [ ] continued task\n\noutside\n',
    )
  })

  test('task widgets toggle through undo and redo and persist canonical markers', async ({
    page,
    request,
  }) => {
    const source = '# Tasks\n\n- [ ] open\n- [X] upper\n  - [ ] nested\n'
    await writeFile(request, TODO_PATH, source)
    await page.goto(`/?dir=Notes&viewing=${encodeURIComponent(TODO_PATH)}`)
    const document = markdownDocument(page, 'edit')
    const tasks = document.locator('.cm-md-task-checkbox')
    await expect(tasks).toHaveCount(3)

    await tasks.nth(0).click()
    await expect(tasks.nth(0)).toBeChecked()
    await page.keyboard.press('Control+z')
    await expect(tasks.nth(0)).not.toBeChecked()
    await page.keyboard.press('Control+y')
    await expect(tasks.nth(0)).toBeChecked()

    await tasks.nth(2).click()
    await expect(tasks.nth(2)).toBeChecked()
    await tasks.nth(1).click()
    await expect(tasks.nth(1)).not.toBeChecked()
    await tasks.nth(1).click()
    await expect(tasks.nth(1)).toBeChecked()
    await saveMarkdown(page)

    expect(await readFile(request, TODO_PATH)).toBe(
      '# Tasks\n\n- [x] open\n- [x] upper\n  - [x] nested\n',
    )

    await page.getByRole('button', { name: 'Read only' }).click()
    const readTasks = markdownDocument(page, 'read').locator('.cm-md-task-checkbox')
    await expect(readTasks).toHaveCount(3)
    for (let index = 0; index < 3; index += 1) await expect(readTasks.nth(index)).toBeDisabled()
  })

  test('structured HTML and plain clipboard text paste as Markdown', async ({ page, request }) => {
    await writeFile(request, TODO_PATH, 'replace me\n')
    await page.goto(`/?dir=Notes&viewing=${encodeURIComponent(TODO_PATH)}`)
    const editor = markdownEditor(page)
    await editor.click()
    await page.keyboard.press('Control+a')

    await dispatchPaste(page, {
      html: [
        '<h2>Gemini heading</h2>',
        '<p><strong>bold</strong> and <em>italic</em> ',
        '<a href="https://example.com">linked</a></p>',
        '<ul><li>list item</li></ul>',
        '<blockquote>quoted</blockquote>',
        '<pre><code>const answer = 42\nnext()</code></pre>',
      ].join(''),
      plain: 'structured paste must win over this fallback',
    })
    const document = markdownDocument(page, 'edit')
    await expect(document.locator('.cm-md-heading-2')).toContainText('Gemini heading')
    expect(await document.locator('.cm-md-code-block-line').count()).toBeGreaterThanOrEqual(2)
    await expect(editor).not.toContainText('replace me')

    await page.keyboard.press('Control+z')
    await expect(editor).toContainText('replace me')
    await page.keyboard.press('Control+y')
    await expect(document.locator('.cm-md-heading-2')).toContainText('Gemini heading')

    await editor.click()
    await page.keyboard.press('Control+End')
    const plain = '\n\n# raw **Markdown**\n  trailing spaces  '
    await dispatchPaste(page, { plain })
    await saveMarkdown(page)

    const persisted = await readFile(request, TODO_PATH)
    expect(persisted).toContain('## Gemini heading')
    expect(persisted).toContain('**bold**')
    expect(persisted).toMatch(/[_*]italic[_*]/)
    expect(persisted).toContain('[linked](https://example.com)')
    expect(persisted).toMatch(/^-\s+list item$/m)
    expect(persisted).toContain('> quoted')
    expect(persisted).toContain('```\nconst answer = 42\nnext()\n```')
    expect(persisted).not.toContain('structured paste must win over this fallback')
    expect(persisted.endsWith(plain)).toBe(true)
  })

  test('Ctrl+S saves Markdown edits instead of opening browser page save', async ({
    page,
    request,
  }) => {
    await page.goto(`/?dir=Notes&viewing=${encodeURIComponent(TODO_PATH)}`)
    const updated = '# Updated Todo\n\n- Brand new item\n'
    await replaceMarkdown(page, updated)
    await Promise.all([
      page.waitForResponse(
        (response) => response.url().includes('/api/files/edit') && response.status() === 200,
      ),
      markdownEditor(page).press('Control+s'),
    ])
    expect(await readFile(request, TODO_PATH)).toBe(updated)

    await page.locator('button[title="Close"]').click()
    await page.locator('table').getByText('markdown-editor-e2e.md').click()
    const reopened = markdownDocument(page, 'edit')
    await expect(reopened.locator('.cm-md-heading-1')).toContainText('Updated Todo')
    await expect(reopened.locator('.cm-line').filter({ hasText: 'Brand new item' })).toBeVisible()
  })

  test('closes text viewer returns to file list', async ({ page }) => {
    await page.goto(`/?dir=Documents&viewing=${encodeURIComponent('Documents/readme.txt')}`)
    await expect(page.getByText('This is a test readme file')).toBeVisible()
    await page.locator('button[title="Close"]').click()
    await expect(page).not.toHaveURL(/viewing=/)
    await expect(page.locator('table').getByText('readme.txt')).toBeVisible()
  })

  test('displays JSON files', async ({ page }) => {
    await page.goto(`/?dir=Documents&viewing=${encodeURIComponent('Documents/data.json')}`)
    await expect(page).toHaveURL(/viewing=.*data\.json/)
    await expect(page.locator('button[title="Close"]')).toBeVisible()
    await expect(page.getByText('"name"')).toBeVisible()
    await expect(page.getByText('"test"')).toBeVisible()
  })

  test('copy-to-clipboard button exists', async ({ page }) => {
    await page.goto(`/?dir=Documents&viewing=${encodeURIComponent('Documents/readme.txt')}`)
    await expect(page.locator('button[title="Copy to clipboard"]')).toBeVisible()
  })

  test('with auto-save off, blur does not persist ordinary text edits', async ({ page }) => {
    const pathEnc = encodeURIComponent(AUTOSAVE_PATH)
    await page.goto(`/?dir=Notes&viewing=${pathEnc}`)
    const textarea = page.locator('textarea')
    await expect(textarea).toBeVisible()

    let editResponses = 0
    page.on('response', (resp) => {
      if (resp.url().includes('/api/files/edit') && resp.status() === 200) editResponses += 1
    })

    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/settings/autoSave') && r.status() === 200),
      page.getByRole('button', { name: 'Auto-save' }).click(),
    ])
    await textarea.fill('autosave off probe\n\nunique-string-xyz-123\n')

    await page.locator('button[title="Close"]').focus()
    await page.waitForTimeout(2300)

    expect(editResponses).toBe(0)

    await page.locator('button[title="Close"]').click()
    await page.locator('table').getByText('autosave-parity.txt').click()
    await expect(textarea).toBeVisible()
    expect(await textarea.inputValue()).not.toContain('unique-string-xyz-123')

    await textarea.fill(AUTOSAVE_SOURCE)
    await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/api/files/edit') && resp.status() === 200,
      ),
      page.getByRole('button', { name: 'Save', exact: true }).click(),
    ])
  })

  test('shows autosave errors and restores an ordinary text draft after reload', async ({
    page,
  }) => {
    const draft = 'recovered local draft after failed autosave\n'
    const pathEnc = encodeURIComponent(AUTOSAVE_PATH)
    await page.route('**/api/files/edit', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"error":"Unavailable"}',
      }),
    )
    await page.goto(`/?dir=Notes&viewing=${pathEnc}`)

    const textarea = page.locator('textarea')
    await expect(textarea).toBeVisible()
    await textarea.fill(draft)
    await page.locator('button[title="Close"]').focus()
    const retry = page.getByRole('button', { name: 'Save failed — retry' })
    await expect(retry).toBeVisible()
    await expect(retry).toHaveAttribute('title', /503|Unavailable/)

    page.once('dialog', (dialog) => dialog.accept())
    await page.reload()
    await expect(textarea).toHaveValue(draft)

    await page.unroute('**/api/files/edit')
    await textarea.fill(AUTOSAVE_SOURCE)
    await page.locator('button[title="Close"]').click()
    await expect(page).not.toHaveURL(/viewing=/)
  })
})
