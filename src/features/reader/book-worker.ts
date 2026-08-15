/// <reference lib="webworker" />

import {
  DOMParser,
  XMLSerializer,
  type Element as XmlElement,
  type Node as XmlNode,
} from '@xmldom/xmldom'
import { strFromU8, unzipSync } from 'fflate'
import { normalizeBookPath, resolveBookPath, splitBookHref } from './book-path'
import type {
  BookChapter,
  BookDocument,
  BookOutlineItem,
  BookResource,
  BookWorkerRequest,
  BookWorkerResponse,
} from './book-types'

const MAX_SOURCE = 100 * 1024 * 1024
const MAX_EXPANDED = 500 * 1024 * 1024
const MAX_ENTRY = 50 * 1024 * 1024
const MAX_CHAPTER = 10 * 1024 * 1024
const MAX_ENTRIES = 10_000
const parser = new DOMParser()
const serializer = new XMLSerializer()

const elementChildren = (node: XmlNode) =>
  Array.from(node.childNodes).filter((child): child is XmlElement => child.nodeType === 1)
const localName = (node: XmlNode) =>
  (node.localName || node.nodeName.split(':').at(-1) || '').toLowerCase()
const descendants = (node: XmlNode, name: string) => {
  const result: XmlElement[] = []
  const visit = (current: XmlNode) => {
    for (const child of elementChildren(current)) {
      if (localName(child) === name) result.push(child)
      visit(child)
    }
  }
  visit(node)
  return result
}
const first = (node: XmlNode, name: string) => descendants(node, name)[0]
const text = (node: XmlNode | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
const attr = (node: XmlElement | undefined, name: string) =>
  node?.getAttribute(name) ?? node?.getAttribute(`xlink:${name}`) ?? ''
const xml = (value: string) => {
  const document = parser.parseFromString(value, 'application/xml')
  if (descendants(document, 'parsererror').length) throw new Error('Malformed XML document')
  return document
}
const entryText = (entries: Record<string, Uint8Array>, path: string) => {
  const bytes = entries[normalizeBookPath(path)]
  if (!bytes) throw new Error(`Book entry is missing: ${path}`)
  if (bytes.byteLength > MAX_CHAPTER) throw new Error(`Book chapter exceeds 10 MB: ${path}`)
  return strFromU8(bytes)
}
const mediaTypeFor = (path: string) => {
  const ext = path.split('.').at(-1)?.toLowerCase()
  return (
    {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      woff: 'font/woff',
      woff2: 'font/woff2',
      ttf: 'font/ttf',
      otf: 'font/otf',
    }[ext ?? ''] ?? 'application/octet-stream'
  )
}

function validateZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const minimum = Math.max(0, bytes.byteLength - 65_557)
  let eocd = -1
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset
      break
    }
  }
  if (eocd < 0) throw new Error('ZIP end record is missing')
  if (
    view.getUint16(eocd + 4, true) !== 0 ||
    view.getUint16(eocd + 6, true) !== 0 ||
    view.getUint16(eocd + 8, true) !== view.getUint16(eocd + 10, true)
  )
    throw new Error('Multi-disk ZIP books are not supported')
  const entryCount = view.getUint16(eocd + 10, true)
  const centralSize = view.getUint32(eocd + 12, true)
  const centralOffset = view.getUint32(eocd + 16, true)
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff)
    throw new Error('ZIP64 books are not supported')
  if (entryCount > MAX_ENTRIES) throw new Error('Book archive contains more than 10,000 entries')
  if (centralOffset + centralSize > bytes.byteLength)
    throw new Error('ZIP central directory is invalid')
  let offset = centralOffset
  let expanded = 0
  let actualEntries = 0
  while (offset < centralOffset + centralSize) {
    actualEntries += 1
    if (actualEntries > MAX_ENTRIES)
      throw new Error('Book archive contains more than 10,000 entries')
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error('ZIP central directory is malformed')
    const size = view.getUint32(offset + 24, true)
    if (size === 0xffffffff) throw new Error('ZIP64 entries are not supported')
    if (size > MAX_ENTRY) throw new Error('Book archive entry exceeds 50 MB')
    expanded += size
    if (expanded > MAX_EXPANDED) throw new Error('Book archive expands beyond 500 MB')
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    offset += 46 + nameLength + extraLength + commentLength
  }
  if (actualEntries !== entryCount || offset !== centralOffset + centralSize)
    throw new Error('ZIP central directory entry count is invalid')
}

function epubOutline(navMarkup: string, navPath: string, chapters: BookChapter[]) {
  const document = xml(navMarkup)
  const nav = descendants(document, 'nav').find((node) => {
    const type = node.getAttribute('epub:type') ?? node.getAttribute('type') ?? ''
    return type.split(/\s+/).includes('toc')
  })
  if (!nav) return []
  let sequence = 0
  const parseList = (list: XmlElement): BookOutlineItem[] =>
    elementChildren(list)
      .filter((child) => localName(child) === 'li')
      .flatMap((item) => {
        const link = elementChildren(item).find((child) => ['a', 'span'].includes(localName(child)))
        const href = attr(link, 'href')
        const resolved = splitBookHref(
          resolveBookPath(navPath, href) + (href.includes('#') ? `#${href.split('#').at(-1)}` : ''),
        )
        const chapter = chapters.find(
          (candidate) => normalizeBookPath(candidate.href) === resolved.path,
        )
        const nested = elementChildren(item).find((child) =>
          ['ol', 'ul'].includes(localName(child)),
        )
        if (!link || !chapter) return []
        return [
          {
            id: `toc-${sequence++}`,
            label: text(link) || chapter.title || 'Untitled section',
            chapterId: chapter.id,
            anchor: resolved.anchor,
            children: nested ? parseList(nested) : [],
          },
        ]
      })
  const list = descendants(nav, 'ol')[0] ?? descendants(nav, 'ul')[0]
  return list ? parseList(list) : []
}

function ncxOutline(ncxMarkup: string, ncxPath: string, chapters: BookChapter[]) {
  const document = xml(ncxMarkup)
  let sequence = 0
  const parsePoint = (point: XmlElement): BookOutlineItem | null => {
    const content = elementChildren(point).find((child) => localName(child) === 'content')
    const raw = attr(content, 'src')
    const split = splitBookHref(raw)
    const resolved = resolveBookPath(ncxPath, split.path)
    const chapter = chapters.find((candidate) => normalizeBookPath(candidate.href) === resolved)
    if (!chapter) return null
    const label =
      text(first(first(point, 'navlabel') ?? point, 'text')) || chapter.title || 'Untitled section'
    return {
      id: `ncx-${sequence++}`,
      label,
      chapterId: chapter.id,
      anchor: split.anchor,
      children: elementChildren(point)
        .filter((child) => localName(child) === 'navpoint')
        .map(parsePoint)
        .filter((item): item is BookOutlineItem => item !== null),
    }
  }
  const navMap = first(document, 'navmap')
  return navMap
    ? elementChildren(navMap)
        .filter((child) => localName(child) === 'navpoint')
        .map(parsePoint)
        .filter((item): item is BookOutlineItem => item !== null)
    : []
}

function parseEpub(bytes: Uint8Array): BookDocument {
  validateZip(bytes)
  const entries = unzipSync(bytes)
  const paths = Object.keys(entries)
  if (paths.length > MAX_ENTRIES) throw new Error('EPUB contains more than 10,000 entries')
  let expanded = 0
  for (const [path, value] of Object.entries(entries)) {
    if (value.byteLength > MAX_ENTRY) throw new Error(`EPUB resource exceeds 50 MB: ${path}`)
    expanded += value.byteLength
    if (expanded > MAX_EXPANDED) throw new Error('EPUB expands beyond 500 MB')
  }
  const container = xml(entryText(entries, 'META-INF/container.xml'))
  if (entries['META-INF/encryption.xml'])
    throw new Error('Encrypted or DRM-protected EPUB files are not supported')
  const packagePath = attr(first(container, 'rootfile'), 'full-path')
  if (!packagePath) throw new Error('EPUB package path is missing')
  const packageDocument = xml(entryText(entries, packagePath))
  const fixedLayout = descendants(packageDocument, 'meta').some(
    (item) => attr(item, 'property') === 'rendition:layout' && text(item) === 'pre-paginated',
  )
  if (fixedLayout) throw new Error('Fixed-layout EPUB files are not supported in continuous reader')
  const manifest = new Map(
    descendants(packageDocument, 'item').map((item) => [
      attr(item, 'id'),
      {
        path: resolveBookPath(packagePath, attr(item, 'href')),
        type: attr(item, 'media-type'),
        properties: attr(item, 'properties').split(/\s+/),
      },
    ]),
  )
  const chapters: BookChapter[] = descendants(packageDocument, 'itemref')
    .filter((item) => attr(item, 'linear') !== 'no')
    .flatMap((item, index) => {
      const source = manifest.get(attr(item, 'idref'))
      if (!source || !['application/xhtml+xml', 'text/html'].includes(source.type)) return []
      const markup = entryText(entries, source.path)
      const document = xml(markup)
      const body = first(document, 'body')
      if (!body) return []
      const heading = descendants(body, 'h1')[0] ?? descendants(body, 'h2')[0]
      const documentTitle = first(document, 'title')
      return [
        {
          id: `chapter-${index}`,
          href: source.path,
          title: text(heading) || text(documentTitle),
          markup: Array.from(body.childNodes)
            .map((node) => serializer.serializeToString(node))
            .join(''),
          textLength: text(body).length,
        },
      ]
    })
  if (!chapters.length) throw new Error('EPUB has no readable spine chapters')
  const navEntry = [...manifest.values()].find((item) => item.properties.includes('nav'))
  const ncxEntry = [...manifest.values()].find((item) => item.type === 'application/x-dtbncx+xml')
  const outline = navEntry
    ? epubOutline(entryText(entries, navEntry.path), navEntry.path, chapters)
    : ncxEntry
      ? ncxOutline(entryText(entries, ncxEntry.path), ncxEntry.path, chapters)
      : []
  const outlineTitles = new Map<string, string>()
  const collectOutlineTitles = (items: BookOutlineItem[]) => {
    for (const item of items) {
      if (!outlineTitles.has(item.chapterId)) outlineTitles.set(item.chapterId, item.label)
      collectOutlineTitles(item.children)
    }
  }
  collectOutlineTitles(outline)
  chapters.forEach((chapter) => {
    const outlineTitle = outlineTitles.get(chapter.id)
    if (outlineTitle) chapter.title = outlineTitle
    else if (!chapter.title) chapter.title = 'Book section'
  })
  const allowedResource = /^(image\/|font\/)|\/svg\+xml$/
  const resources: BookResource[] = [...manifest.values()]
    .filter((item) => allowedResource.test(item.type) && entries[item.path])
    .map((item) => ({ path: item.path, mediaType: item.type, bytes: entries[item.path]! }))
  const styles = [...manifest.values()]
    .filter((item) => item.type === 'text/css' && entries[item.path])
    .map((item) => ({ path: item.path, css: entryText(entries, item.path) }))
  const legacyCoverId = descendants(packageDocument, 'meta')
    .find((item) => attr(item, 'name') === 'cover')
    ?.getAttribute('content')
  const coverItem =
    [...manifest.values()].find((item) => item.properties.includes('cover-image')) ??
    (legacyCoverId ? manifest.get(legacyCoverId) : undefined)
  if (coverItem && entries[coverItem.path]) {
    chapters.unshift({
      id: 'cover',
      href: packagePath,
      title: 'Cover',
      markup: `<figure data-book-cover=""><img src="${coverItem.path}" alt="Cover" /></figure>`,
      textLength: 0,
    })
  }
  const metadata = first(packageDocument, 'metadata') ?? packageDocument
  return {
    format: 'epub',
    metadata: {
      title: text(first(metadata, 'title')),
      authors: descendants(metadata, 'creator')
        .map((node) => text(node))
        .filter(Boolean),
      language: text(first(metadata, 'language')) || undefined,
    },
    chapters,
    outline,
    resources,
    styles,
  }
}

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

function fb2Html(node: XmlNode): string {
  if (node.nodeType === 3 || node.nodeType === 4) return escapeHtml(node.nodeValue ?? '')
  if (node.nodeType !== 1) return ''
  const element = node as XmlElement
  const name = localName(element)
  if (name === 'section') return elementChildren(element).map(fb2Html).join('')
  const mapped: Record<string, string> = {
    p: 'p',
    subtitle: 'h3',
    emphasis: 'em',
    strong: 'strong',
    strikethrough: 's',
    code: 'code',
    cite: 'blockquote',
    epigraph: 'blockquote',
    poem: 'div',
    stanza: 'div',
    v: 'p',
    'text-author': 'cite',
    table: 'table',
    tr: 'tr',
    td: 'td',
    th: 'th',
    sup: 'sup',
    sub: 'sub',
  }
  if (name === 'title') return `<h2>${Array.from(element.childNodes).map(fb2Html).join('')}</h2>`
  if (name === 'empty-line') return '<br />'
  if (name === 'image') return `<img src="${escapeHtml(attr(element, 'href'))}" alt="" />`
  if (name === 'a')
    return `<a href="${escapeHtml(attr(element, 'href'))}">${Array.from(element.childNodes).map(fb2Html).join('')}</a>`
  const tag = mapped[name]
  const content = Array.from(element.childNodes).map(fb2Html).join('')
  return tag ? `<${tag}>${content}</${tag}>` : content
}

const fb2SectionHtml = (section: XmlElement) =>
  Array.from(section.childNodes)
    .filter((child) => child.nodeType !== 1 || localName(child) !== 'section')
    .map(fb2Html)
    .join('')

function parseFb2(bytes: Uint8Array): BookDocument {
  const prefix = new TextDecoder().decode(bytes.slice(0, 256))
  const encoding = /encoding=["']([^"']+)/i.exec(prefix)?.[1] || 'utf-8'
  let source: string
  try {
    source = new TextDecoder(encoding).decode(bytes)
  } catch {
    source = new TextDecoder().decode(bytes)
  }
  const document = xml(source)
  const description = first(document, 'description')
  const titleInfo = description ? first(description, 'title-info') : undefined
  const authorName = (author: XmlElement) =>
    ['first-name', 'middle-name', 'last-name', 'nickname']
      .map((part) => text(first(author, part)))
      .filter(Boolean)
      .join(' ')
  const resources: BookResource[] = descendants(document, 'binary').flatMap((binary) => {
    const id = attr(binary, 'id')
    const mediaType = attr(binary, 'content-type') || mediaTypeFor(id)
    const encoded = text(binary).replace(/\s+/g, '')
    if (!id || !encoded || encoded.length > MAX_ENTRY * 1.4) return []
    try {
      const raw = atob(encoded)
      const data = Uint8Array.from(raw, (character) => character.charCodeAt(0))
      return [{ path: id, mediaType, bytes: data }]
    } catch {
      return []
    }
  })
  let sequence = 0
  const chapters: BookChapter[] = []
  const outlineForSection = (section: XmlElement): BookOutlineItem => {
    const id = attr(section, 'id') || `fb2-section-${sequence}`
    const titleNode = elementChildren(section).find((node) => localName(node) === 'title')
    const label = text(titleNode) || `Section ${sequence + 1}`
    const chapterId = `chapter-${sequence++}`
    chapters.push({
      id: chapterId,
      href: id,
      title: label,
      markup: fb2SectionHtml(section),
      textLength: text(section).length,
    })
    return {
      id: `toc-${id}`,
      label,
      chapterId,
      anchor: id,
      children: elementChildren(section)
        .filter((child) => localName(child) === 'section')
        .map(outlineForSection),
    }
  }
  const bodies = descendants(document, 'body').filter((body) => !attr(body, 'name'))
  const outline = bodies.flatMap((body) =>
    elementChildren(body)
      .filter((child) => localName(child) === 'section')
      .map(outlineForSection),
  )
  if (!chapters.length) throw new Error('FB2 has no readable sections')
  const coverImage = titleInfo
    ? first(first(titleInfo, 'coverpage') ?? titleInfo, 'image')
    : undefined
  const coverPath = attr(coverImage, 'href').replace(/^#/, '')
  if (coverPath && resources.some((resource) => resource.path === coverPath)) {
    chapters.unshift({
      id: 'cover',
      href: 'cover',
      title: 'Cover',
      markup: `<figure data-book-cover=""><img src="#${escapeHtml(coverPath)}" alt="Cover" /></figure>`,
      textLength: 0,
    })
  }
  const sequenceNode = titleInfo ? first(titleInfo, 'sequence') : undefined
  return {
    format: 'fb2',
    metadata: {
      title: text(titleInfo ? first(titleInfo, 'book-title') : undefined),
      authors: titleInfo ? descendants(titleInfo, 'author').map(authorName).filter(Boolean) : [],
      language: text(titleInfo ? first(titleInfo, 'lang') : undefined) || undefined,
      series: attr(sequenceNode, 'name') || undefined,
    },
    chapters,
    outline,
    resources,
    styles: [],
  }
}

self.onmessage = (event: MessageEvent<BookWorkerRequest>) => {
  const reply = (message: BookWorkerResponse) => self.postMessage(message)
  try {
    const bytes = new Uint8Array(event.data.bytes)
    if (bytes.byteLength > MAX_SOURCE) throw new Error('Book file exceeds 100 MB')
    const lower = event.data.fileName.toLowerCase()
    const document = lower.endsWith('.epub')
      ? parseEpub(bytes)
      : lower.endsWith('.fb2.zip') || (lower.endsWith('.zip') && bytes[0] === 0x50)
        ? (() => {
            validateZip(bytes)
            const entries = unzipSync(bytes)
            const fb2 = Object.entries(entries).filter(([path]) =>
              path.toLowerCase().endsWith('.fb2'),
            )
            if (fb2.length !== 1) throw new Error('FB2 ZIP must contain exactly one .fb2 file')
            return parseFb2(fb2[0]![1])
          })()
        : parseFb2(bytes)
    reply({ ok: true, document })
  } catch (error) {
    reply({ ok: false, error: error instanceof Error ? error.message : 'Could not parse book' })
  }
}
