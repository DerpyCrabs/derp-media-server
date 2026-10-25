import { DOMParser, type Element as XmlElement, type Node as XmlNode } from '@xmldom/xmldom'
import { strFromU8, unzipSync } from 'fflate'
import type { BookChapter, BookDocument, BookOutlineItem, BookResource } from './book-types'
import { normalizeBookPath, resolveBookPath } from './book-path'

const MAX_SOURCE = 64 * 1024 * 1024
const MAX_EXPANDED = 128 * 1024 * 1024
const MAX_ENTRY = 16 * 1024 * 1024
const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  )
const children = (node: XmlNode): XmlElement[] =>
  Array.from(node.childNodes).filter((child): child is XmlElement => child.nodeType === 1)
const name = (node: XmlNode) =>
  (node.localName || node.nodeName.split(':').at(-1) || '').toLowerCase()
const child = (node: XmlNode | undefined, local: string) =>
  node ? children(node).find((item) => name(item) === local) : undefined
const attr = (node: XmlElement | undefined, local: string) => {
  if (!node) return ''
  for (const attribute of Array.from(node.attributes))
    if ((attribute.localName || attribute.name.split(':').at(-1)) === local) return attribute.value
  return ''
}
const all = (node: XmlNode, local: string): XmlElement[] => {
  const result: XmlElement[] = [],
    stack = [node]
  while (stack.length) {
    const next = stack.pop()!
    if (next.nodeType === 1 && name(next) === local) result.push(next as XmlElement)
    stack.push(...children(next).reverse())
  }
  return result
}
const plain = (node: XmlNode | undefined) => node?.textContent?.trim() ?? ''
const integer = (value: string, fallback: number, max: number) =>
  /^\d+$/.test(value) ? Math.min(max, Number(value)) : fallback

function readPackage(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_SOURCE) throw new Error('Document exceeds the 64 MB preview limit.')
  if (bytes.byteLength < 22) throw new Error('This is not a DOCX or ODT document package.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (
      view.getUint32(offset, true) === 0x06054b50 &&
      offset + 22 + view.getUint16(offset + 20, true) === bytes.length
    ) {
      end = offset
      break
    }
  }
  if (end < 0)
    throw new Error(
      'The document package is damaged or encrypted. Open the original in an office application.',
    )
  const count = view.getUint16(end + 10, true),
    size = view.getUint32(end + 12, true),
    start = view.getUint32(end + 16, true)
  if (
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    view.getUint16(end + 8, true) !== count ||
    count > 5000 ||
    start + size > end
  )
    throw new Error('Unsupported document package layout.')
  let offset = start,
    expanded = 0
  const names = new Set<string>()
  for (let index = 0; index < count; index++) {
    if (offset + 46 > start + size || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error('Damaged document directory.')
    const length = view.getUint32(offset + 24, true),
      filenameSize = view.getUint16(offset + 28, true)
    const next =
      offset +
      46 +
      filenameSize +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true)
    if (next > start + size || view.getUint16(offset + 8, true) & 1)
      throw new Error('Encrypted or damaged documents cannot be previewed.')
    expanded += length
    if (length > MAX_ENTRY || expanded > MAX_EXPANDED)
      throw new Error(
        'The expanded document exceeds the preview limit (16 MB per entry, 128 MB total).',
      )
    const raw = strFromU8(bytes.subarray(offset + 46, offset + 46 + filenameSize)),
      path = normalizeBookPath(raw)
    if (
      raw.includes('\0') ||
      raw.startsWith('/') ||
      raw.replace(/\\/g, '/').split('/').includes('..') ||
      names.has(path)
    )
      throw new Error('The document contains ambiguous package paths.')
    names.add(path)
    offset = next
  }
  if (offset !== start + size) throw new Error('Damaged document directory.')
  const entries = unzipSync(bytes, {
    filter: (file) =>
      /\.(?:xml|rels|png|jpe?g|gif|webp|svg|bmp)$/i.test(file.name) || file.name === 'mimetype',
  })
  const result: Record<string, Uint8Array> = Object.create(null)
  for (const [path, content] of Object.entries(entries)) result[normalizeBookPath(path)] = content
  return result
}

function parseXml(bytes: Uint8Array | undefined, required = false) {
  if (!bytes) {
    if (required) throw new Error('The document content is missing.')
    return undefined
  }
  if (bytes.length > 8 * 1024 * 1024)
    throw new Error('A document XML part exceeds the 8 MB preview limit.')
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? 'utf-16be'
        : 'utf-8'
  const text = new TextDecoder(encoding, { fatal: true }).decode(bytes)
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error('Document XML with entity declarations is not supported.')
  const document = new DOMParser({
    onError: (level) => {
      if (level !== 'warning') throw new Error('Malformed document XML.')
    },
  }).parseFromString(text, 'application/xml')
  const stack: Array<[XmlNode, number]> = [[document, 0]]
  let nodes = 0
  while (stack.length) {
    const [node, depth] = stack.pop()!
    if (++nodes > 200000 || depth > 128) throw new Error('The document is too complex to preview.')
    for (const item of Array.from(node.childNodes)) stack.push([item, depth + 1])
  }
  return document
}

type Block = { html: string; text: string; heading?: number; title?: string }
function makeDocument(
  format: 'docx' | 'odt',
  title: string,
  authors: string[],
  blocks: Block[],
  resources: BookResource[],
  notices: Set<string>,
): BookDocument {
  const chapters: BookChapter[] = [],
    outline: BookOutlineItem[] = []
  const headingStack: Array<{ level: number; item: BookOutlineItem }> = []
  let current: BookChapter | undefined
  for (const block of blocks) {
    if (!current || block.heading || current.textLength > 50000) {
      const index = chapters.length,
        id = `document-section-${index}`
      current = {
        id,
        href: `${id}.xhtml`,
        title: block.title || (index ? `Section ${index + 1}` : title || 'Document'),
        markup: '',
        textLength: 0,
      }
      chapters.push(current)
      if (block.heading) {
        const item: BookOutlineItem = { id, label: current.title, chapterId: id, children: [] }
        while (headingStack.length && headingStack.at(-1)!.level >= block.heading)
          headingStack.pop()
        if (headingStack.length) headingStack.at(-1)!.item.children.push(item)
        else outline.push(item)
        headingStack.push({ level: block.heading, item })
      }
    }
    current.markup += block.html
    current.textLength += block.text.length
  }
  if (!chapters.length)
    chapters.push({
      id: 'document-section-0',
      href: 'document-section-0.xhtml',
      title: title || 'Document',
      markup: '<p>This document has no text content.</p>',
      textLength: 0,
    })
  // Resolve package bookmarks after chapter splitting, including links to later sections.
  const anchors = new Map<string, string>()
  for (const chapter of chapters)
    for (const match of chapter.markup.matchAll(/ id="([^"]+)"/g))
      anchors.set(match[1]!, chapter.href)
  for (const chapter of chapters)
    chapter.markup = chapter.markup.replace(/href="#([^"]+)"/g, (full, anchor: string) =>
      anchors.has(anchor) ? `href="${anchors.get(anchor)}#${anchor}"` : full,
    )
  return {
    format,
    metadata: { title, authors },
    chapters,
    outline,
    resources,
    notices: [...notices],
    styles: [
      {
        path: 'document.css',
        css: 'table {border-collapse:collapse;max-width:100%;} td,th {border:1px solid #888;padding:0.35em;vertical-align:top;} td p,th p {margin-block:0.2em;} ol,ul {margin-block:0.15em;padding-inline-start:1.5em;} ol {list-style-type:decimal;} ul {list-style-type:disc;} img {max-width:100%;height:auto;} p {white-space:pre-wrap;}',
      },
    ],
  }
}

function resourcesFrom(entries: Record<string, Uint8Array>, used: Set<string>): BookResource[] {
  return [...used].flatMap((path) => {
    const bytes = entries[path],
      mediaType = IMAGE_TYPES[path.split('.').at(-1)?.toLowerCase() ?? '']
    return bytes && mediaType ? [{ path, bytes, mediaType }] : []
  })
}

type Relationship = { target: string; external: boolean; type: string }
function relationships(
  entries: Record<string, Uint8Array>,
  part: string,
): Map<string, Relationship> {
  const parts = part.split('/'),
    filename = parts.pop()!
  const relPath = [...parts, '_rels', `${filename}.rels`].join('/')
  const document = parseXml(entries[relPath]),
    result = new Map<string, Relationship>()
  if (document)
    for (const rel of all(document, 'relationship')) {
      const target = attr(rel, 'Target'),
        external = attr(rel, 'TargetMode') === 'External'
      result.set(attr(rel, 'Id'), {
        target: external
          ? target
          : target.startsWith('/')
            ? normalizeBookPath(target)
            : resolveBookPath(part, target),
        external,
        type: attr(rel, 'Type'),
      })
    }
  return result
}

function parseDocx(entries: Record<string, Uint8Array>): BookDocument {
  const rootRelations = relationships(entries, '')
  const mainPart =
    [...rootRelations.values()].find((rel) => /\/officeDocument$/.test(rel.type) && !rel.external)
      ?.target || 'word/document.xml'
  const document = parseXml(entries[mainPart], true)!,
    body = all(document, 'body')[0]
  if (!body || name(document.documentElement!) !== 'document')
    throw new Error('The package does not contain a Word document.')
  const rels = relationships(entries, mainPart),
    used = new Set<string>(),
    notices = new Set<string>()
  const stylesPart =
    [...rels.values()].find((rel) => /\/styles$/.test(rel.type) && !rel.external)?.target ||
    'word/styles.xml'
  const stylesXml = parseXml(entries[stylesPart]),
    styles = new Map<string, XmlElement>()
  if (stylesXml)
    for (const style of all(stylesXml, 'style')) styles.set(attr(style, 'styleId'), style)
  const stylesFor = (id: string): XmlElement[] => {
    const chain: XmlElement[] = [],
      seen = new Set<string>()
    while (id && !seen.has(id) && chain.length < 16) {
      seen.add(id)
      const style = styles.get(id)
      if (!style) break
      chain.unshift(style)
      id = attr(child(style, 'basedon'), 'val')
    }
    return chain
  }
  const property = (nodes: Array<XmlElement | undefined>, key: string) =>
    nodes
      .map((node) => child(node, key))
      .filter((node): node is XmlElement => !!node)
      .at(-1)
  const enabled = (node: XmlElement | undefined) =>
    !!node && !['0', 'false', 'off', 'none'].includes(attr(node, 'val'))
  const relatedPart = (kind: string, fallback: string) =>
    [...rels.values()].find((rel) => rel.type.endsWith(`/${kind}`) && !rel.external)?.target ||
    fallback
  let activeRels = rels
  const numberingXml = parseXml(entries[relatedPart('numbering', 'word/numbering.xml')]),
    numbering = new Map<string, XmlElement>(),
    definitions = new Map<string, XmlElement>(),
    counters = new Map<string, number>()
  if (numberingXml) {
    for (const node of all(numberingXml, 'num')) numbering.set(attr(node, 'numId'), node)
    for (const node of all(numberingXml, 'abstractnum'))
      definitions.set(attr(node, 'abstractNumId'), node)
  }
  let currentRunStyle: Array<XmlElement | undefined> = []
  const render = (node: XmlNode): string => {
    if (node.nodeType !== 1) return ''
    const element = node as XmlElement,
      tag = name(node),
      content = () => children(node).map(render).join('')
    if (
      [
        'ppr',
        'rpr',
        'tblpr',
        'tblgrid',
        'tcpr',
        'trpr',
        'sectpr',
        'del',
        'movefrom',
        'instrtext',
        'deltext',
        'prooferr',
      ].includes(tag)
    )
      return ''
    if (tag === 'alternatecontent') {
      const selected = child(node, 'choice') ?? child(node, 'fallback')
      return selected ? render(selected) : ''
    }
    if (tag === 't') return escape(node.textContent ?? '')
    if (tag === 'tab') return '\t'
    if (tag === 'br' || tag === 'cr') return '<br />'
    if (tag === 'nobreakhyphen') return '‑'
    if (tag === 'softhyphen') return '\u00ad'
    if (tag === 'bookmarkstart') {
      const id = attr(element, 'name')
      return id ? `<span id="${escape(id)}"></span>` : ''
    }
    if (tag === 'hyperlink') {
      const rel = activeRels.get(attr(element, 'id')),
        anchor = attr(element, 'anchor')
      const href = anchor
        ? `#${anchor}`
        : rel?.external && /^https?:\/\//i.test(rel.target)
          ? rel.target
          : ''
      return href ? `<a href="${escape(href)}">${content()}</a>` : content()
    }
    if (tag === 'blip' || tag === 'imagedata') {
      const rel = activeRels.get(attr(element, tag === 'blip' ? 'embed' : 'id'))
      if (
        rel &&
        !rel.external &&
        entries[rel.target] &&
        IMAGE_TYPES[rel.target.split('.').at(-1)?.toLowerCase() ?? '']
      ) {
        used.add(rel.target)
        return `<img src="${escape(rel.target)}" alt="Embedded image" />`
      }
      notices.add('Some linked or unsupported images are omitted.')
      return '<span>[Image unavailable in preview]</span>'
    }
    if (['chart', 'object', 'oleobject', 'altchunk'].includes(tag)) {
      notices.add('Embedded objects and charts are not rendered.')
      return '<p>[Embedded object — open the original to view]</p>'
    }
    if (tag === 'footnotereference' || tag === 'endnotereference')
      return `<sup><a href="#${tag}-${escape(attr(element, 'id'))}">${escape(attr(element, 'id'))}</a></sup>`
    if (tag === 'r') {
      const own = child(node, 'rpr'),
        properties = [
          ...currentRunStyle,
          ...stylesFor(attr(child(own, 'rstyle'), 'val')).map((style) => child(style, 'rpr')),
          own,
        ]
      if (enabled(property(properties, 'vanish'))) return ''
      let html = content()
      if (enabled(property(properties, 'b'))) html = `<strong>${html}</strong>`
      if (enabled(property(properties, 'i'))) html = `<em>${html}</em>`
      if (enabled(property(properties, 'u'))) html = `<u>${html}</u>`
      if (enabled(property(properties, 'strike'))) html = `<s>${html}</s>`
      const vertical = attr(property(properties, 'vertalign'), 'val')
      if (vertical === 'superscript') html = `<sup>${html}</sup>`
      if (vertical === 'subscript') html = `<sub>${html}</sub>`
      return html
    }
    if (tag === 'p') {
      const props = child(node, 'ppr'),
        id = attr(child(props, 'pstyle'), 'val'),
        inherited = stylesFor(id)
      const paragraph = [...inherited.map((style) => child(style, 'ppr')), props]
      const outline = attr(property(paragraph, 'outlinelvl'), 'val'),
        styleName = attr(child(styles.get(id), 'name'), 'val') || id
      const heading =
        /^\d+$/.test(outline) && Number(outline) < 6
          ? Number(outline) + 1
          : Number(/heading\s*([1-6])/i.exec(styleName)?.[1] ?? 0)
      const previous = currentRunStyle
      currentRunStyle = inherited.map((style) => child(style, 'rpr'))
      const html = content() || '<br />'
      currentRunStyle = previous
      const alignment = attr(property(paragraph, 'jc'), 'val'),
        align = ['left', 'right', 'center', 'justify'].includes(alignment)
          ? alignment
          : alignment === 'both'
            ? 'justify'
            : ''
      const style = align ? ` style="text-align:${align}"` : ''
      if (heading) return `<h${heading}${style}>${html}</h${heading}>`
      const numberProps = property(paragraph, 'numpr'),
        numId = attr(child(numberProps, 'numid'), 'val')
      if (numId && numId !== '0') {
        const depth = integer(attr(child(numberProps, 'ilvl'), 'val'), 0, 8),
          definition = definitions.get(attr(child(numbering.get(numId), 'abstractnumid'), 'val'))
        const level =
          definition &&
          children(definition).find(
            (item) => name(item) === 'lvl' && attr(item, 'ilvl') === String(depth),
          )
        const key = `${numId}:${depth}`,
          count = counters.get(key) ?? integer(attr(child(level, 'start'), 'val'), 1, 999999)
        counters.set(key, count + 1)
        const bullet = attr(child(level, 'numfmt'), 'val') === 'bullet',
          list = bullet ? 'ul' : 'ol'
        return `<${list}${bullet ? '' : ` start="${count}"`} style="padding-inline-start:${(depth + 1) * 1.5}em"><li${style}>${html}</li></${list}>`
      }
      return `<p${style}>${html}</p>`
    }
    if (tag === 'tbl') {
      type Cell = { html: string; columns: number; rows: number }
      const rows: Cell[][] = [],
        active = new Map<number, Cell>()
      for (const row of children(node).filter((item) => name(item) === 'tr')) {
        const cells: Cell[] = [],
          next = new Map<number, Cell>()
        let column = 0
        for (const cell of children(row).filter((item) => name(item) === 'tc')) {
          const props = child(cell, 'tcpr'),
            span = Math.max(1, integer(attr(child(props, 'gridspan'), 'val'), 1, 100)),
            merge = child(props, 'vmerge')
          if (merge && attr(merge, 'val') !== 'restart' && active.has(column)) {
            const previous = active.get(column)!
            previous.rows++
            next.set(column, previous)
          } else {
            const value = { html: children(cell).map(render).join(''), columns: span, rows: 1 }
            cells.push(value)
            if (merge) next.set(column, value)
          }
          column += span
        }
        active.clear()
        for (const [key, value] of next) active.set(key, value)
        rows.push(cells)
      }
      return `<table><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td colspan="${cell.columns}" rowspan="${cell.rows}">${cell.html}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    }
    return content()
  }
  const blocks: Block[] = children(body)
    .map((node) => {
      const html = render(node),
        heading = Number(/^<h([1-6])/.exec(html)?.[1] ?? 0)
      return {
        html,
        text: plain(node),
        ...(heading
          ? {
              heading,
              title: all(node, 't')
                .map((item) => item.textContent)
                .join(''),
            }
          : {}),
      }
    })
    .filter((block) => block.html)
  for (const [kind, ref] of [
    ['footnotes', 'footnotereference'],
    ['endnotes', 'endnotereference'],
  ] as const) {
    const part = relatedPart(kind, `word/${kind}.xml`)
    const notes = parseXml(entries[part])
    if (!notes) continue
    activeRels = relationships(entries, part)
    const items = children(notes.documentElement!).filter(
      (node) => !attr(node, 'type') && /^\d+$/.test(attr(node, 'id')),
    )
    if (items.length)
      blocks.push({
        heading: 1,
        title: kind === 'footnotes' ? 'Footnotes' : 'Endnotes',
        text: items.map(plain).join(' '),
        html: `<h1>${kind === 'footnotes' ? 'Footnotes' : 'Endnotes'}</h1>${items.map((node) => `<div id="${ref}-${escape(attr(node, 'id'))}"><strong>${escape(attr(node, 'id'))}.</strong>${children(node).map(render).join('')}</div>`).join('')}`,
      })
  }
  const metadata = parseXml(entries['docProps/core.xml'])
  return makeDocument(
    'docx',
    metadata ? plain(all(metadata, 'title')[0]) : '',
    metadata ? all(metadata, 'creator').map(plain).filter(Boolean) : [],
    blocks,
    resourcesFrom(entries, used),
    notices,
  )
}

function parseOdt(entries: Record<string, Uint8Array>): BookDocument {
  const manifest = parseXml(entries['META-INF/manifest.xml'])
  if (manifest && all(manifest, 'encryption-data').length)
    throw new Error(
      'Encrypted ODT documents cannot be previewed. Open the original in an office application.',
    )
  const document = parseXml(entries['content.xml'], true)!,
    body = all(document, 'body')[0],
    content = body && child(body, 'text')
  if (!content) throw new Error('The package does not contain an OpenDocument text document.')
  const stylesDocument = parseXml(entries['styles.xml']),
    styles = new Map<string, XmlElement>(),
    listStyles = new Map<string, XmlElement>()
  for (const source of [stylesDocument, document])
    if (source) {
      for (const style of all(source, 'style')) styles.set(attr(style, 'name'), style)
      for (const style of all(source, 'list-style')) listStyles.set(attr(style, 'name'), style)
    }
  const used = new Set<string>(),
    notices = new Set<string>()
  const properties = (element: XmlElement, type: string) => {
    let id = attr(element, 'style-name')
    const values: Record<string, string> = {},
      seen = new Set<string>(),
      chain: XmlElement[] = []
    while (id && !seen.has(id) && chain.length < 16) {
      seen.add(id)
      const style = styles.get(id)
      if (!style) break
      chain.unshift(style)
      id = attr(style, 'parent-style-name')
    }
    for (const style of chain) {
      const props = child(style, type)
      if (props)
        for (const attribute of Array.from(props.attributes))
          values[attribute.localName || attribute.name] = attribute.value
    }
    return values
  }
  const footnotes: Array<{ id: string; citation: string; body: XmlElement }> = []
  let renderedCells = 0
  const render = (node: XmlNode, listDepth = 1, listStyle = ''): string => {
    if (node.nodeType === 3 || node.nodeType === 4) return escape(node.nodeValue ?? '')
    if (node.nodeType !== 1) return ''
    const element = node as XmlElement,
      tag = name(node)
    const inner = () =>
      Array.from(node.childNodes)
        .map((item) => render(item, listDepth, listStyle))
        .join('')
    if (
      [
        'tracked-changes',
        'annotation',
        'annotation-end',
        'change',
        'change-start',
        'change-end',
        'sequence-decls',
        'user-field-decls',
        'variable-decls',
        'forms',
        'scripts',
        'event-listeners',
      ].includes(tag)
    )
      return ''
    if (tag === 's') return ' '.repeat(Math.max(1, integer(attr(element, 'c'), 1, 1000)))
    if (tag === 'tab') return '\t'
    if (tag === 'line-break') return '<br />'
    if (tag === 'bookmark' || tag === 'bookmark-start' || tag === 'reference-mark-start')
      return `<span id="${escape(attr(element, 'name'))}"></span>`
    if (tag === 'a') {
      const href = attr(element, 'href')
      return /^(?:https?:\/\/|#)/i.test(href) ? `<a href="${escape(href)}">${inner()}</a>` : inner()
    }
    if (tag === 'span') {
      const props = properties(element, 'text-properties')
      let html = inner()
      if (props['font-weight'] === 'bold' || Number(props['font-weight']) >= 600)
        html = `<strong>${html}</strong>`
      if (props['font-style'] === 'italic') html = `<em>${html}</em>`
      if (props['text-underline-style'] && props['text-underline-style'] !== 'none')
        html = `<u>${html}</u>`
      if (props['text-line-through-style'] && props['text-line-through-style'] !== 'none')
        html = `<s>${html}</s>`
      if (props['text-position']?.startsWith('super')) html = `<sup>${html}</sup>`
      if (props['text-position']?.startsWith('sub')) html = `<sub>${html}</sub>`
      return html
    }
    if (tag === 'p' || tag === 'h') {
      const props = properties(element, 'paragraph-properties'),
        textProps = properties(element, 'text-properties'),
        alignment = props['text-align'],
        align = ['left', 'right', 'center', 'justify', 'start', 'end'].includes(alignment ?? '')
          ? ` style="text-align:${alignment}"`
          : ''
      const heading = tag === 'h' ? Math.max(1, integer(attr(element, 'outline-level'), 1, 6)) : 0
      let html = inner() || '<br />'
      if (textProps['font-weight'] === 'bold') html = `<strong>${html}</strong>`
      if (textProps['font-style'] === 'italic') html = `<em>${html}</em>`
      return `<${heading ? `h${heading}` : 'p'}${align}>${html}</${heading ? `h${heading}` : 'p'}>`
    }
    if (tag === 'list') {
      const style = attr(element, 'style-name') || listStyle,
        definition = listStyles.get(style)
      const level =
        definition &&
        children(definition).find((item) => integer(attr(item, 'level'), 1, 10) === listDepth)
      const ordered = level && name(level) === 'list-level-style-number',
        listTag = ordered ? 'ol' : 'ul'
      const start = integer(
        attr(child(element, 'list-item'), 'start-value'),
        integer(attr(level, 'start-value'), 1, 999999),
        999999,
      )
      return `<${listTag}${ordered ? ` start="${start}"` : ''}>${children(node)
        .map((item) =>
          name(item) === 'list-item'
            ? `<li>${Array.from(item.childNodes)
                .map((value) => render(value, listDepth + 1, style))
                .join('')}</li>`
            : render(item, listDepth, style),
        )
        .join('')}</${listTag}>`
    }
    if (tag === 'image') {
      const href = attr(element, 'href'),
        path = normalizeBookPath(href)
      if (
        !/^[a-z][\w+.-]*:|^\/\//i.test(href) &&
        entries[path] &&
        IMAGE_TYPES[path.split('.').at(-1)?.toLowerCase() ?? '']
      ) {
        used.add(path)
        return `<img src="${escape(path)}" alt="Embedded image" />`
      }
      notices.add('Some linked or unsupported images are omitted.')
      return '<span>[Image unavailable in preview]</span>'
    }
    if (tag === 'object' || tag === 'object-ole') {
      notices.add('Embedded objects and charts are not rendered.')
      return '<p>[Embedded object — open the original to view]</p>'
    }
    if (tag === 'table')
      return `<table><tbody>${children(node)
        .map((item) => render(item, listDepth, listStyle))
        .join('')}</tbody></table>`
    if (tag === 'table-row') {
      if (Number(attr(element, 'number-rows-repeated')) > 1000)
        throw new Error('Repeated table rows exceed the preview limit.')
      const count = integer(attr(element, 'number-rows-repeated'), 1, 1000)
      const html = `<tr>${children(node)
        .map((item) => render(item, listDepth, listStyle))
        .join('')}</tr>`
      if (count > 1 && html.length * count > 2 * 1024 * 1024)
        throw new Error('Repeated table rows exceed the preview limit.')
      renderedCells += count
      if (renderedCells > 20000) throw new Error('Document tables exceed the preview limit.')
      return html.repeat(count)
    }
    if (tag === 'covered-table-cell' || tag === 'table-column') return ''
    if (tag === 'table-cell') {
      if (Number(attr(element, 'number-columns-repeated')) > 1000)
        throw new Error('Repeated table cells exceed the preview limit.')
      const columns = Math.max(1, integer(attr(element, 'number-columns-spanned'), 1, 100)),
        rows = Math.max(1, integer(attr(element, 'number-rows-spanned'), 1, 1000)),
        repeat = integer(attr(element, 'number-columns-repeated'), 1, 1000)
      renderedCells += repeat
      if (renderedCells > 20000) throw new Error('Document tables exceed the preview limit.')
      const html = `<td colspan="${columns}" rowspan="${rows}">${inner()}</td>`
      if (html.length * repeat > 2 * 1024 * 1024)
        throw new Error('Repeated table cells exceed the preview limit.')
      return html.repeat(repeat)
    }
    if (tag === 'note') {
      const body = child(node, 'note-body'),
        citation = plain(child(node, 'note-citation')) || String(footnotes.length + 1),
        id = `odt-footnote-${footnotes.length}`
      if (body) footnotes.push({ id, citation, body })
      return `<sup><a href="#${id}">${escape(citation)}</a></sup>`
    }
    return inner()
  }
  const blocks: Block[] = []
  const append = (node: XmlElement) => {
    if (name(node) === 'section') {
      children(node).forEach(append)
      return
    }
    const html = render(node),
      heading = name(node) === 'h' ? Math.max(1, integer(attr(node, 'outline-level'), 1, 6)) : 0
    if (html.trim())
      blocks.push({ html, text: plain(node), ...(heading ? { heading, title: plain(node) } : {}) })
  }
  children(content).forEach(append)
  if (footnotes.length) {
    const notes = [...footnotes]
    const html = notes
      .map(
        (note) =>
          `<div id="${note.id}"><strong>${escape(note.citation)}.</strong>${children(note.body)
            .map((item) => render(item))
            .join('')}</div>`,
      )
      .join('')
    blocks.push({
      heading: 1,
      title: 'Notes',
      text: notes.map((note) => plain(note.body)).join(' '),
      html: `<h1>Notes</h1>${html}`,
    })
  }
  const metadata = parseXml(entries['meta.xml'])
  return makeDocument(
    'odt',
    metadata ? plain(all(metadata, 'title')[0]) : '',
    metadata ? all(metadata, 'initial-creator').map(plain).filter(Boolean) : [],
    blocks,
    resourcesFrom(entries, used),
    notices,
  )
}

export function parseOfficeDocument(bytes: Uint8Array, fileName: string): BookDocument {
  const entries = readPackage(bytes)
  const document = fileName.toLowerCase().endsWith('.odt') ? parseOdt(entries) : parseDocx(entries)
  if (
    document.chapters.reduce((size, chapter) => size + chapter.markup.length, 0) >
    16 * 1024 * 1024
  )
    throw new Error('Rendered document exceeds the 16 MB preview limit.')
  return document
}
