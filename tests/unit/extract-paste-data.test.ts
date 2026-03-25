import { describe, expect, test } from 'bun:test'
import {
  clipboardHtmlToPlainText,
  extractPasteDataFromClipboardData,
} from '@/lib/extract-paste-data'

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
})
