import type { SyntaxNode } from '@lezer/common'
import type { Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

import {
  collectMarkdownReferenceDefinitions,
  decodeMarkdownDestination,
  decodeMarkdownText,
  normalizeMarkdownReferenceLabel,
} from '@/lib/markdown/markdown-parser'

export { normalizeMarkdownReferenceLabel }

export type MarkdownLink = {
  from: number
  to: number
  labelFrom: number
  labelTo: number
  href: string
}

export type MarkdownReferenceResolver = (label: string) => string | undefined

function directChild(node: SyntaxNode, name: string): SyntaxNode | null {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === name) return child
  }
  return null
}

export function createMarkdownReferenceResolver(
  root: SyntaxNode,
  doc: Text,
): MarkdownReferenceResolver {
  let definitions: Map<string, string> | null = null

  return (label) => {
    definitions ??= collectMarkdownReferenceDefinitions(root, (from, to) =>
      doc.sliceString(from, to),
    )
    return definitions.get(normalizeMarkdownReferenceLabel(label))
  }
}

function isExternalLink(href: string): boolean {
  return /^(?:https?:|[\\/]{2})/i.test(href)
}

function normalizedLinkHref(href: string): string {
  const trimmed = href.trim()
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return `mailto:${trimmed}`
  if (/^www\./i.test(trimmed)) return `http://${trimmed}`
  return trimmed
}

export function isSafeMarkdownHref(href: string): boolean {
  const normalized = decodeMarkdownText(href)
    .trim()
    .replace(/[\u0000-\u001f\u007f\s]+/g, '')
  if (!normalized) return false
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(normalized)?.[1]?.toLowerCase()
  return (
    !scheme || scheme === 'http' || scheme === 'https' || scheme === 'mailto' || scheme === 'tel'
  )
}

export function extractMarkdownLink(
  node: SyntaxNode,
  doc: Text,
  resolveReference?: MarkdownReferenceResolver,
): MarkdownLink | null {
  if (node.name === 'URL' && node.parent?.name !== 'Link' && node.parent?.name !== 'Autolink') {
    return {
      from: node.from,
      to: node.to,
      labelFrom: node.from,
      labelTo: node.to,
      href: normalizedLinkHref(decodeMarkdownText(doc.sliceString(node.from, node.to))),
    }
  }
  if (node.name === 'Autolink') {
    const url = node.getChild('URL')
    if (!url) return null
    return {
      from: node.from,
      to: node.to,
      labelFrom: url.from,
      labelTo: url.to,
      href: normalizedLinkHref(decodeMarkdownText(doc.sliceString(url.from, url.to))),
    }
  }
  if (node.name !== 'Link') return null

  const url = node.getChild('URL')
  let open: SyntaxNode | null = null
  let close: SyntaxNode | null = null
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'LinkMark') continue
    const text = doc.sliceString(child.from, child.to)
    if (text === '[') open = child
    else if (text === ']' && !close) close = child
  }
  if (!open || !close || close.from < open.to) return null
  let rawHref = url ? decodeMarkdownDestination(doc.sliceString(url.from, url.to)) : undefined
  if (!rawHref && resolveReference) {
    const reference = directChild(node, 'LinkLabel')
    const explicitLabel = reference ? doc.sliceString(reference.from + 1, reference.to - 1) : ''
    const visibleLabel = doc.sliceString(open.to, close.from)
    rawHref = resolveReference(explicitLabel || visibleLabel)
  }
  if (!rawHref) return null
  return {
    from: node.from,
    to: node.to,
    labelFrom: open.to,
    labelTo: close.from,
    href: normalizedLinkHref(rawHref),
  }
}

export function openMarkdownLink(href: string): void {
  if (!isSafeMarkdownHref(href)) return
  if (isExternalLink(href)) {
    const opened = window.open(href, '_blank', 'noopener,noreferrer')
    if (opened) opened.opener = null
    return
  }
  window.location.assign(href)
}

export function markdownLinkAttributes(link: MarkdownLink, native = false): Record<string, string> {
  const safe = isSafeMarkdownHref(link.href)
  const external = isExternalLink(link.href)
  return {
    role: 'link',
    tabindex: '0',
    'data-markdown-link': link.href,
    'data-markdown-from': String(link.from),
    'data-markdown-to': String(link.to),
    ...(external ? { 'data-markdown-external': 'true' } : {}),
    ...(native && safe ? { href: link.href } : {}),
    ...(native && safe && external ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
  }
}

function linkElement(event: Event): HTMLElement | null {
  const target = event.target
  return target instanceof Element
    ? (target.closest<HTMLElement>('[data-markdown-link]') ?? null)
    : null
}

export function markdownLinkInteractionExtension() {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (view.state.readOnly) return false
      const element = linkElement(event)
      if (!element || !(event.ctrlKey || event.metaKey)) return false
      event.preventDefault()
      event.stopPropagation()
      openMarkdownLink(element.dataset.markdownLink ?? '')
      return true
    },
    click(event, view) {
      if (!view.state.readOnly) return false
      const element = linkElement(event)
      if (!element) return false
      if (element.tagName === 'A' && element.hasAttribute('href')) return false
      event.preventDefault()
      event.stopPropagation()
      openMarkdownLink(element.dataset.markdownLink ?? '')
      return true
    },
    keydown(event, view) {
      if (!view.state.readOnly || event.key !== 'Enter') return false
      const element = linkElement(event)
      if (!element) return false
      if (element.tagName === 'A' && element.hasAttribute('href')) return false
      event.preventDefault()
      event.stopPropagation()
      openMarkdownLink(element.dataset.markdownLink ?? '')
      return true
    },
  })
}
