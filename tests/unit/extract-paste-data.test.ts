import './test-dom-globals'

import { describe, expect, test } from 'bun:test'
import {
  clipboardHtmlToMarkdown,
  clipboardHtmlToPlainText,
  extractPasteDataFromClipboardData,
} from '@/lib/extract-paste-data'

const GEMINI_STYLE_HTML =
  '<h3><b>Section Title</b></h3><p><i>(note)</i></p><h4><b>Block</b></h4><ol><li><p><b>Item:</b> one.</p><ul><li><p><i>How:</i> detail</p></li></ul></li></ol>'

class MockDataTransfer {
  private readonly data = new Map<string, string>()
  readonly files = [] as unknown as FileList
  readonly items = [] as unknown as DataTransferItemList

  setData(type: string, value: string) {
    this.data.set(type, value)
  }

  getData(type: string) {
    return this.data.get(type) ?? ''
  }
}

function makeTransfer() {
  return new MockDataTransfer() as unknown as DataTransfer
}

describe('clipboardHtmlToPlainText', () => {
  test('strips tags and trims', () => {
    expect(clipboardHtmlToPlainText('<p>hello <b>world</b></p>')).toBe('hello world')
  })

  test('normalizes nbsp', () => {
    expect(clipboardHtmlToPlainText('<span>a\u00a0b</span>')).toBe('a b')
  })
})

describe('clipboardHtmlToMarkdown', () => {
  test('preserves headings, lists, and emphasis', () => {
    const md = clipboardHtmlToMarkdown(GEMINI_STYLE_HTML)
    expect(md).toContain('###')
    expect(md).toContain('Section Title')
    expect(md).toContain('**Item:**')
    expect(md).toMatch(/[_*]How:[_*]/)
    expect(md).toMatch(/1\.|1\s/)
  })
})

describe('extractPasteDataFromClipboardData', () => {
  test('uses md extension when requested', async () => {
    const dt = makeTransfer()
    dt.setData('text/plain', 'x')
    const data = await extractPasteDataFromClipboardData(dt, { textSuggestedExtension: 'md' })
    expect(data?.type).toBe('text')
    expect(data?.suggestedName.endsWith('.md')).toBe(true)
    expect(data?.content).toBe('x')
  })

  test('uses txt extension by default', async () => {
    const dt = makeTransfer()
    dt.setData('text/plain', 'y')
    const data = await extractPasteDataFromClipboardData(dt)
    expect(data?.suggestedName.endsWith('.txt')).toBe(true)
  })

  test('falls back from html when plain is empty', async () => {
    const dt = makeTransfer()
    dt.setData('text/html', '<div><p>From chat</p></div>')
    const data = await extractPasteDataFromClipboardData(dt, { textSuggestedExtension: 'md' })
    expect(data?.type).toBe('text')
    expect(data?.content).toBe('From chat')
    expect(data?.suggestedName.endsWith('.md')).toBe(true)
  })

  test('ignores html when plain has content', async () => {
    const dt = makeTransfer()
    dt.setData('text/plain', 'plain only')
    dt.setData('text/html', '<p>html</p>')
    const data = await extractPasteDataFromClipboardData(dt)
    expect(data?.content).toBe('plain only')
  })

  test('md prefers structured html over plain when both present', async () => {
    const dt = makeTransfer()
    dt.setData('text/plain', 'flat gemini plain without structure')
    dt.setData('text/html', GEMINI_STYLE_HTML)
    const data = await extractPasteDataFromClipboardData(dt, { textSuggestedExtension: 'md' })
    expect(data?.type).toBe('text')
    expect(data?.content).toContain('###')
    expect(data?.content).not.toBe('flat gemini plain without structure')
  })

  test('md keeps plain when html is trivial', async () => {
    const dt = makeTransfer()
    dt.setData('text/plain', 'hello')
    dt.setData('text/html', '<p>hello</p>')
    const data = await extractPasteDataFromClipboardData(dt, { textSuggestedExtension: 'md' })
    expect(data?.content).toBe('hello')
  })

  test('txt still prefers plain when html is structured', async () => {
    const dt = makeTransfer()
    dt.setData('text/plain', 'plain wins')
    dt.setData('text/html', GEMINI_STYLE_HTML)
    const data = await extractPasteDataFromClipboardData(dt, { textSuggestedExtension: 'txt' })
    expect(data?.content).toBe('plain wins')
  })

  test('txt falls back to flattened html when plain empty', async () => {
    const dt = makeTransfer()
    dt.setData('text/html', GEMINI_STYLE_HTML)
    const data = await extractPasteDataFromClipboardData(dt)
    expect(data?.type).toBe('text')
    expect(data?.suggestedName.endsWith('.txt')).toBe(true)
    expect(data?.content).toContain('Section Title')
    expect(data?.content).not.toContain('###')
  })
})
