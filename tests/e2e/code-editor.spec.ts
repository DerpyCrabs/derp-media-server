import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
async function openCode(
  page: Page,
  request: APIRequestContext,
  extension: string,
  content: string,
) {
  const path = `Notes/code-${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`
  expect((await request.post('/api/files/create', { data: { path, content } })).ok()).toBe(true)
  await request.post('/api/settings/autoSave', {
    data: { filePath: path, enabled: false, readOnly: false },
  })
  await page.goto(`/?dir=Notes&viewing=${encodeURIComponent(path)}`)
  const document = page.getByTestId('plain-text-document')
  const editor = document.getByRole('textbox')
  await expect(editor).toBeVisible()
  return { path, document, editor }
}
test('JSON highlighting and folding preserve exact source, settings preserve undo and cursor position', async ({
  page,
  request,
}) => {
  const source = '{\r\n    "enabled": true,\r\n    "count": 4\r\n}\r\n'
  const { path, document, editor } = await openCode(page, request, 'json', source)
  await expect(document.getByRole('button', { name: 'Editor options', exact: true })).toContainText(
    'JSON',
  )
  await expect(editor.locator('span').filter({ hasText: /^true$/ })).toBeVisible()
  const folds = document.locator('.cm-foldGutter .cm-gutterElement').filter({ hasText: '⌄' })
  await expect(folds.first()).toBeVisible()
  await folds.first().click()
  await expect(editor.locator('.cm-foldPlaceholder')).toBeVisible()
  await editor.locator('.cm-foldPlaceholder').click()
  await editor.focus()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('// draft')
  await expect(document.getByRole('button', { name: 'Editor options' })).toHaveAttribute(
    'title',
    /Ln 5, Col 9/,
  )
  await document.getByRole('button', { name: 'Editor options', exact: true }).click()
  const options = page.getByRole('dialog', { name: 'Editor options', exact: true })
  await expect(options.getByRole('button', { name: 'Indentation', exact: true })).toContainText(
    'Automatic (4 spaces)',
  )
  await options.getByRole('button', { name: 'Syntax language', exact: true }).click()
  await page.getByRole('option', { name: 'Plain text', exact: true }).click()
  await options.getByRole('checkbox', { name: 'Line numbers', exact: true }).uncheck()
  await page.keyboard.press('Escape')
  await expect(document.locator('.cm-lineNumbers')).toHaveCount(0)
  await document.getByRole('button', { name: 'Editor options', exact: true }).click()
  await options.getByRole('checkbox', { name: 'Wrap lines', exact: true }).uncheck()
  await page.keyboard.press('Escape')
  await expect(document.locator('.cm-lineWrapping')).toHaveCount(0)
  await editor.focus()
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+s')
  await expect.poll(async () => (await request.get(`/api/media/${path}`)).text()).toBe(source)
  await expect(document.locator('.cm-lineWrapping')).toHaveCount(0)
  await page.reload()
  await expect(document.locator('.cm-lineWrapping')).toHaveCount(0)
  await expect(page.locator('.cm-lineNumbers')).toHaveCount(0)
})
test('indentation options change new input without rewriting existing tabs or line endings', async ({
  page,
  request,
}) => {
  const { path, document, editor } = await openCode(
    page,
    request,
    'py',
    'def greet():\r\n\tprint("hello")\r\n',
  )
  await document.getByRole('button', { name: 'Editor options', exact: true }).click()
  const options = page.getByRole('dialog', { name: 'Editor options', exact: true })
  await expect(options.getByRole('button', { name: 'Indentation', exact: true })).toContainText(
    'Automatic (tabs)',
  )
  await options.getByRole('button', { name: 'Indentation', exact: true }).click()
  await page.getByRole('option', { name: '4 spaces', exact: true }).click()
  await page.keyboard.press('Escape')
  await editor.focus()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Tab')
  await page.keyboard.insertText('pass')
  await page.keyboard.press('Control+s')
  await expect
    .poll(async () => (await request.get(`/api/media/${path}`)).text())
    .toBe('def greet():\r\n\tprint("hello")\r\n    pass')
})
test('automatic language changes while editing an extensionless script do not reset undo', async ({
  page,
  request,
}) => {
  const { document, editor } = await openCode(page, request, 'txt', 'original\n')
  await editor.fill('#!/usr/bin/env python3\nprint("hello")\n')
  await expect(document.getByRole('button', { name: 'Editor options', exact: true })).toContainText(
    'Python',
  )
  await expect(editor.locator('span').filter({ hasText: /^"hello"$/ })).toBeVisible()
  await editor.focus()
  await page.keyboard.press('Control+z')
  await expect(editor).toContainText('original')
  await expect(document.getByRole('button', { name: 'Editor options', exact: true })).toContainText(
    'Plain text',
  )
})

test('large code files remain editable without loading a parser for the entire file', async ({
  page,
  request,
}) => {
  const source = '// long configuration example\n'.repeat(75000)
  const { path, document, editor } = await openCode(page, request, 'js', source)
  await expect(document.getByRole('status')).toContainText(
    'Syntax highlighting is disabled for files larger than 2 MiB',
  )
  await editor.focus()
  await page.keyboard.press('Control+Home')
  await page.keyboard.insertText('// added\n')
  await expect(editor).toContainText('// added')
  const saving = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/files/edit') && response.request().method() === 'POST',
  )
  await page.keyboard.press('Control+s')
  expect((await saving).ok()).toBe(true)
  expect(await (await request.get(`/api/media/${path}`)).text()).toBe('// added\n' + source)
})

test('unavailable editor code preserves readable source and the existing download action', async ({
  page,
  request,
}) => {
  await page.route('**/assets/PlainTextDocument-*.js', (route) => route.abort('failed'))
  const path = `Notes/editor-load-failure-${Date.now()}.txt`
  await request.post('/api/files/create', { data: { path, content: 'Text remains accessible.' } })
  await page.goto(`/?dir=Notes&viewing=${encodeURIComponent(path)}`)
  await expect(page.getByRole('alert')).toContainText('The editor could not be loaded')
  await expect(page.locator('pre')).toContainText('Text remains accessible.')
  await page.getByRole('button', { name: 'Document actions', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Download', exact: true })).toBeVisible()
})
