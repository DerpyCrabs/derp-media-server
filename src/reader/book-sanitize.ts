import { normalizeBookPath, resolveBookPath } from './book-path'
import type { BookChapter, BookDocument } from './book-types'

const SAFE_ELEMENTS = new Set([
  'a',
  'abbr',
  'b',
  'blockquote',
  'br',
  'caption',
  'cite',
  'code',
  'dd',
  'del',
  'dfn',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  'q',
  'ruby',
  'rp',
  'rt',
  's',
  'section',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
])
const SAFE_STYLE = new Set([
  'font-style',
  'font-weight',
  'font-variant',
  'text-align',
  'text-decoration',
  'text-indent',
  'font-family',
  'font-size',
  'line-height',
  'color',
  'background-color',
  'text-transform',
  'letter-spacing',
  'word-spacing',
  'white-space',
  'vertical-align',
  'direction',
  'margin-block-start',
  'margin-block-end',
  'padding-inline-start',
])

export type RenderedBook = BookDocument & {
  chapters: Array<BookChapter & { html: string }>
  css: string
  release: () => void
}

const SAFE_CSS = new Set([
  ...SAFE_STYLE,
  'display',
  'margin',
  'margin-block',
  'margin-inline',
  'padding',
  'padding-block',
  'padding-inline',
  'border',
  'border-width',
  'border-style',
  'border-color',
  'border-radius',
  'list-style',
  'list-style-type',
  'float',
  'clear',
  'width',
  'max-width',
  'min-width',
  'height',
  'max-height',
])

function safeDeclarations(value: string, allowed = SAFE_CSS) {
  return value
    .split(';')
    .flatMap((declaration) => {
      const [rawName, ...rawValue] = declaration.split(':')
      const name = rawName?.trim().toLowerCase()
      const property = rawValue
        .join(':')
        .replace(/\s*!important\b/gi, '')
        .trim()
      if (!name || !allowed.has(name) || /url\s*\(|expression|@import|javascript:/i.test(property))
        return []
      return [`${name}:${property}`]
    })
    .join(';')
}

function safeInlineStyle(value: string) {
  return safeDeclarations(value, SAFE_STYLE)
}

function safeFontDeclarations(
  value: string,
  stylesheetPath: string,
  urls: Map<string, string>,
  fontPaths: Set<string>,
) {
  const allowed = new Set([
    'font-family',
    'font-style',
    'font-weight',
    'font-stretch',
    'font-display',
    'unicode-range',
  ])
  const declarations = safeDeclarations(value, allowed)
  const src = value
    .split(';')
    .find((declaration) => declaration.split(':', 1)[0]?.trim().toLowerCase() === 'src')
  if (!src) return declarations
  const rawValue = src.slice(src.indexOf(':') + 1)
  let invalid = false
  const rewritten = rawValue.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
    (_match, _quote, raw: string) => {
      let resolved = ''
      try {
        resolved = resolveBookPath(stylesheetPath, raw.trim())
      } catch {
        invalid = true
        return ''
      }
      const blob = fontPaths.has(resolved) ? urls.get(resolved) : undefined
      if (!blob) {
        invalid = true
        return ''
      }
      return `url("${blob}")`
    },
  )
  if (invalid || !/url\(/i.test(rewritten) || /url\(\s*['"]?(?:https?:|data:|\/)/i.test(rewritten))
    return declarations
  return [declarations, `src:${rewritten}`].filter(Boolean).join(';')
}

function safeStylesheets(
  styles: BookDocument['styles'],
  urls: Map<string, string>,
  fontPaths: Set<string>,
) {
  return styles
    .map(({ path, css }) => {
      const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
      const fonts: string[] = []
      const rules = withoutComments.replace(
        /@font-face\s*\{([^{}]*)\}/gi,
        (_match, body: string) => {
          const declarations = safeFontDeclarations(body, path, urls, fontPaths)
          if (declarations) fonts.push(`@font-face {${declarations}}`)
          return ''
        },
      )
      const sanitizedRules = [...rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .map((match) => {
          const [, rawSelectors = '', rawBody = ''] = match
          if (rawSelectors.includes('@')) return ''
          const body = safeDeclarations(rawBody)
          if (!body) return ''
          const selectors = rawSelectors
            .split(',')
            .map((selector) => selector.trim())
            .filter((selector) => selector && !/[\\]|:has\(|javascript:/i.test(selector))
            .map((selector) =>
              /^(html|body|:root)$/i.test(selector)
                ? '.book-document'
                : `.book-document ${selector.replace(/\b(html|body|:root)\b/gi, '.book-document')}`,
            )
          return selectors.length ? `${selectors.join(',')} {${body}}` : ''
        })
        .filter(Boolean)
        .join('\n')
      return [...fonts, sanitizedRules].join('\n')
    })
    .join('\n')
}

function safeResourceBytes(resource: BookDocument['resources'][number]): BlobPart {
  if (resource.mediaType !== 'image/svg+xml') return resource.bytes as BlobPart
  const parsed = new DOMParser().parseFromString(
    new TextDecoder().decode(resource.bytes),
    'image/svg+xml',
  )
  if (parsed.querySelector('parsererror')) return ''
  for (const element of [...parsed.querySelectorAll('*')]) {
    const tag = element.localName.toLowerCase()
    if (
      ['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'style'].includes(
        tag,
      )
    ) {
      element.remove()
      continue
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.localName.toLowerCase()
      const value = attribute.value.trim()
      if (
        name.startsWith('on') ||
        (['href', 'src'].includes(name) && value && !value.startsWith('#')) ||
        (name === 'style' && /url\s*\(|expression|javascript:/i.test(value))
      )
        element.removeAttribute(attribute.name)
    }
  }
  return new XMLSerializer().serializeToString(parsed)
}

export function renderBook(document: BookDocument): RenderedBook {
  const urls = new Map(
    document.resources.map((resource) => [
      resource.path.replace(/^#/, ''),
      URL.createObjectURL(new Blob([safeResourceBytes(resource)], { type: resource.mediaType })),
    ]),
  )
  const fontPaths = new Set(
    document.resources
      .filter((resource) => resource.mediaType.startsWith('font/'))
      .map((resource) => normalizeBookPath(resource.path)),
  )
  const chapterByPath = new Map(document.chapters.map((chapter) => [chapter.href, chapter.id]))
  const sanitize = (chapter: BookChapter) => {
    const parsed = new DOMParser().parseFromString(`<body>${chapter.markup}</body>`, 'text/html')
    const visit = (node: Element) => {
      for (const child of [...node.children]) visit(child)
      const tag = node.tagName.toLowerCase()
      if (!SAFE_ELEMENTS.has(tag)) {
        node.replaceWith(...node.childNodes)
        return
      }
      for (const attribute of [...node.attributes]) {
        const name = attribute.name.toLowerCase()
        if (
          ![
            'id',
            'title',
            'alt',
            'href',
            'src',
            'style',
            'colspan',
            'rowspan',
            'dir',
            'lang',
          ].includes(name)
        ) {
          node.removeAttribute(attribute.name)
        }
      }
      if (node.hasAttribute('style')) {
        const value = safeInlineStyle(node.getAttribute('style') ?? '')
        if (value) node.setAttribute('style', value)
        else node.removeAttribute('style')
      }
      if (tag === 'img') {
        const raw = node.getAttribute('src') ?? ''
        const direct = normalizeBookPath(raw.replace(/^#/, ''))
        const path = urls.has(direct)
          ? direct
          : raw.startsWith('#')
            ? raw.slice(1)
            : resolveBookPath(chapter.href, raw)
        const url = urls.get(path)
        if (url) node.setAttribute('src', url)
        else node.remove()
      }
      if (tag === 'a') {
        const raw = node.getAttribute('href') ?? ''
        if (/^https?:\/\//i.test(raw)) {
          node.setAttribute('target', '_blank')
          node.setAttribute('rel', 'noopener noreferrer')
          ;(node as HTMLElement).dataset.external = 'true'
        } else {
          const [rawPath, anchor] = raw.split('#', 2)
          const resolved = rawPath ? resolveBookPath(chapter.href, rawPath) : chapter.href
          ;(node as HTMLElement).dataset.chapterId = chapterByPath.get(resolved) ?? chapter.id
          if (anchor) {
            let decoded = anchor
            try {
              decoded = decodeURIComponent(anchor)
            } catch {}
            ;(node as HTMLElement).dataset.anchor = decoded
          }
          node.setAttribute('href', '#')
        }
      }
    }
    for (const child of [...parsed.body.children]) visit(child)
    return parsed.body.innerHTML
  }
  return {
    ...document,
    chapters: document.chapters.map((chapter) => ({ ...chapter, html: sanitize(chapter) })),
    css: safeStylesheets(document.styles, urls, fontPaths),
    release: () => urls.forEach((url) => URL.revokeObjectURL(url)),
  }
}
