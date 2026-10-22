import { Effect } from 'effect'
import TurndownService from 'turndown'

import type { PasteData } from '@/lib/files/paste-data'

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
  'strong',
  'b',
  'em',
  'i',
  'a',
  'code',
  'del',
  's',
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

function readFile(file: File, mode: 'text' | 'dataURL') {
  return Effect.callback<string, DOMException>((resume) => {
    const reader = new FileReader()
    reader.onload = () =>
      resume(Effect.succeed(typeof reader.result === 'string' ? reader.result : ''))
    reader.onerror = () =>
      resume(Effect.fail(reader.error ?? new DOMException('Could not read clipboard file')))
    if (mode === 'text') reader.readAsText(file)
    else reader.readAsDataURL(file)
    return Effect.sync(() => {
      reader.onload = null
      reader.onerror = null
      if (reader.readyState === FileReader.LOADING) reader.abort()
    })
  })
}
const readFileAsDataURL = (file: File) => readFile(file, 'dataURL')
const readFileAsText = (file: File) => readFile(file, 'text')

function pasteDataFromFile(file: File): Effect.Effect<PasteData, DOMException> {
  return Effect.gen(function* () {
    const fileName = file.name
    const fileSize = file.size
    const isTextFile = isTextFileType(file.type, fileName)

    if (file.type.startsWith('image/')) {
      const result = yield* readFileAsDataURL(file)
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
      const text = yield* readFileAsText(file)
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

    const result = yield* readFileAsDataURL(file)
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
  })
}

export type ExtractPasteDataOptions = { textSuggestedExtension?: 'md' | 'txt' }

function clipboardHtmlBodyLooksStructured(body: HTMLElement | null): boolean {
  if (!body) return false
  for (const tag of CLIPBOARD_STRUCTURED_SELECTORS) {
    if (body.getElementsByTagName(tag).length > 0) return true
  }
  return false
}

/** True when clipboard HTML carries formatting worth preserving as Markdown. */
export function clipboardHtmlLooksStructured(html: string): boolean {
  if (!html || typeof DOMParser === 'undefined') return false
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return clipboardHtmlBodyLooksStructured(doc.body)
}

function newClipboardTurndown(doc: Document) {
  return new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
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

export function textPasteSuggestedName(content: string, ext: 'md' | 'txt'): string {
  const lines = content.split(/\r?\n/).map((line) => line.trim())
  const heading = lines.find((line) => /^#{1,6}\s+\S/.test(line))?.replace(/^#{1,6}\s+/, '')
  const meaningful = heading ?? lines.find((line) => line && !/^[-*_`>#]+$/.test(line))
  const stem = meaningful
    ?.replace(/<[^>]*>/g, '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return `${stem || `pasted-${Date.now()}`}.${ext}`
}

/** Mirrors `usePaste` clipboard handling (first matching payload wins). */
export function extractPasteDataFromClipboardData(
  clipboardData: DataTransfer | null,
  opts?: ExtractPasteDataOptions,
): Effect.Effect<PasteData | null, DOMException> {
  if (!clipboardData) return Effect.succeed(null)
  const files = Array.from(clipboardData.files ?? [])
  const images = Array.from(clipboardData.items)
    .filter((item) => item.type.startsWith('image/'))
    .map((item) => ({ type: item.type, file: item.getAsFile() }))
  const rawPlain = clipboardData.getData('text/plain')
  const html = clipboardData.getData('text/html')
  return Effect.gen(function* () {
    const textExt = opts?.textSuggestedExtension ?? 'txt'

    if (files && files.length > 0) {
      return yield* pasteDataFromFile(files[0]!)
    }

    const items = images
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        const blob = item.file
        if (blob) {
          const result = yield* readFileAsDataURL(blob)
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

    if (textExt === 'md' && html && typeof DOMParser !== 'undefined') {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      if (clipboardHtmlBodyLooksStructured(doc.body)) {
        const md = documentBodyToMarkdown(doc)
        if (md) {
          const textSize = new Blob([md]).size
          return {
            type: 'text',
            content: md,
            suggestedName: textPasteSuggestedName(md, textExt),
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
        suggestedName: textPasteSuggestedName(rawPlain, textExt),
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
          suggestedName: textPasteSuggestedName(fromHtml, textExt),
          fileSize: textSize,
          showPreview: true,
          isTextContent: true,
        }
      }
    }

    return null
  })
}
