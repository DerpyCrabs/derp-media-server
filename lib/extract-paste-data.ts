import TurndownService from 'turndown'

import type { PasteData } from '@/lib/paste-data'

const CLIPBOARD_STRUCTURED_SELECTORS = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ol',
  'ul',
  'blockquote',
  'pre',
  'table',
] as const

function isTextFileType(mimeType: string, fileName: string): boolean {
  if (mimeType.startsWith('text/')) return true

  const textExtensions = [
    'txt',
    'md',
    'json',
    'xml',
    'csv',
    'log',
    'yaml',
    'yml',
    'ini',
    'conf',
    'sh',
    'bat',
    'ps1',
    'js',
    'ts',
    'jsx',
    'tsx',
    'css',
    'scss',
    'html',
    'htm',
    'py',
    'java',
    'c',
    'cpp',
    'h',
    'cs',
    'go',
    'rs',
    'php',
    'rb',
    'swift',
    'kt',
    'sql',
  ]
  const extension = fileName.split('.').pop()?.toLowerCase()
  return extension ? textExtensions.includes(extension) : false
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const r = reader.result
      resolve(typeof r === 'string' ? r : '')
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const r = reader.result
      resolve(typeof r === 'string' ? r : '')
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

async function pasteDataFromFile(file: File): Promise<PasteData> {
  const fileName = file.name
  const fileSize = file.size
  const isTextFile = isTextFileType(file.type, fileName)

  if (file.type.startsWith('image/')) {
    const result = await readFileAsDataURL(file)
    const base64 = result.split(',')[1] ?? ''
    return {
      type: 'image',
      content: base64,
      suggestedName: fileName,
      fileType: file.type,
      fileSize,
      showPreview: true,
      isTextContent: false,
    }
  }

  if (isTextFile) {
    const text = await readFileAsText(file)
    return {
      type: 'file',
      content: text,
      suggestedName: fileName,
      fileType: file.type,
      fileSize,
      showPreview: true,
      isTextContent: true,
    }
  }

  const result = await readFileAsDataURL(file)
  const base64 = result.split(',')[1] ?? ''
  return {
    type: 'file',
    content: base64,
    suggestedName: fileName,
    fileType: file.type,
    fileSize,
    showPreview: true,
    isTextContent: false,
  }
}

export type ExtractPasteDataOptions = {
  textSuggestedExtension?: 'md' | 'txt'
}

function clipboardHtmlBodyLooksStructured(body: HTMLElement | null): boolean {
  if (!body) return false
  for (const tag of CLIPBOARD_STRUCTURED_SELECTORS) {
    if (body.getElementsByTagName(tag).length > 0) return true
  }
  return false
}

function newClipboardTurndown(doc: Document) {
  return new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    document: doc,
  } as ConstructorParameters<typeof TurndownService>[0] & { document: Document })
}

function documentBodyToMarkdown(doc: Document): string {
  return newClipboardTurndown(doc).turndown(doc.body).trim()
}

/** Converts clipboard HTML to Markdown (browser/KB pastes). */
export function clipboardHtmlToMarkdown(html: string): string {
  if (typeof DOMParser === 'undefined') return clipboardHtmlToPlainText(html)
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const md = documentBodyToMarkdown(doc)
  if (md) return md
  return clipboardHtmlToPlainText(html)
}

/** Strips HTML to plain text for clipboard fallbacks (e.g. web chat UIs). */
export function clipboardHtmlToPlainText(html: string): string {
  let raw = ''
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    raw = doc.body?.textContent ?? ''
  }
  const trimmed = raw
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .trim()
  if (trimmed) return trimmed
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function textPasteSuggestedName(ext: 'md' | 'txt'): string {
  return `pasted-${Date.now()}.${ext}`
}

/** Mirrors `usePaste` clipboard handling (first matching payload wins). */
export async function extractPasteDataFromClipboardData(
  clipboardData: DataTransfer | null,
  opts?: ExtractPasteDataOptions,
): Promise<PasteData | null> {
  if (!clipboardData) return null

  const textExt = opts?.textSuggestedExtension ?? 'txt'

  const files = clipboardData.files
  if (files && files.length > 0) {
    return pasteDataFromFile(files[0])
  }

  const items = clipboardData.items
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.type.startsWith('image/')) {
      const blob = item.getAsFile()
      if (blob) {
        const result = await readFileAsDataURL(blob)
        if (typeof result === 'string') {
          const base64 = result.split(',')[1] ?? ''
          const extension = item.type.split('/')[1] || 'png'
          return {
            type: 'image',
            content: base64,
            suggestedName: `image-${Date.now()}.${extension}`,
            fileType: item.type,
            fileSize: blob.size,
            showPreview: true,
            isTextContent: false,
          }
        }
      }
      return null
    }
  }

  const rawPlain = clipboardData.getData('text/plain')
  const html = clipboardData.getData('text/html')

  if (textExt === 'md' && html && typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    if (clipboardHtmlBodyLooksStructured(doc.body)) {
      const md = documentBodyToMarkdown(doc)
      if (md) {
        const textSize = new Blob([md]).size
        return {
          type: 'text',
          content: md,
          suggestedName: textPasteSuggestedName(textExt),
          fileSize: textSize,
          showPreview: true,
          isTextContent: true,
        }
      }
    }
  }

  if (rawPlain.trim()) {
    const textSize = new Blob([rawPlain]).size
    return {
      type: 'text',
      content: rawPlain,
      suggestedName: textPasteSuggestedName(textExt),
      fileSize: textSize,
      showPreview: true,
      isTextContent: true,
    }
  }

  if (html) {
    const fromHtml =
      textExt === 'md' ? clipboardHtmlToMarkdown(html) : clipboardHtmlToPlainText(html)
    if (fromHtml) {
      const textSize = new Blob([fromHtml]).size
      return {
        type: 'text',
        content: fromHtml,
        suggestedName: textPasteSuggestedName(textExt),
        fileSize: textSize,
        showPreview: true,
        isTextContent: true,
      }
    }
  }

  return null
}
