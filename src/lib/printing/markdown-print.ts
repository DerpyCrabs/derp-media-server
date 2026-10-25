import type { SyntaxNode } from '@lezer/common'
import {
  collectMarkdownReferenceDefinitions,
  decodeMarkdownDestination,
  decodeMarkdownText,
  markdownParser,
  normalizeMarkdownReferenceLabel,
} from '@/lib/markdown/markdown-parser'

export const escapePrintHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  )
export type PrintImage = { source: string; alt: string }
export type PrintedMarkdown = { html: string; images: PrintImage[] }
export function markdownPrint(source: string): PrintedMarkdown {
  if (source.length > 1_048_576)
    throw new Error(
      'Formatted printing supports notes up to 1 MB. Choose source text for larger notes.',
    )
  const root = markdownParser.parse(source).topNode
  const references = collectMarkdownReferenceDefinitions(root, (from, to) => source.slice(from, to))
  const images: PrintImage[] = []
  let visited = 0
  const raw = (node: SyntaxNode) => source.slice(node.from, node.to)
  const direct = (node: SyntaxNode, name: string) => {
    for (let child = node.firstChild; child; child = child.nextSibling)
      if (child.name === name) return child
    return null
  }
  const safeHref = (value: string) =>
    /^(https?:\/\/|mailto:|#)/i.test(value) &&
    value.split('').every((char) => char.charCodeAt(0) > 32)
      ? value
      : ''
  const children = (
    node: SyntaxNode,
    depth: number,
    text = true,
    from = node.from,
    to = node.to,
  ): string => {
    let output = '',
      at = from
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.to <= from || child.from >= to) continue
      if (text && child.from > at) output += escapePrintHtml(source.slice(at, child.from))
      output += render(child, depth + 1)
      at = child.to
    }
    if (text && at < to) output += escapePrintHtml(source.slice(at, to))
    return output
  }
  const link = (node: SyntaxNode, depth: number, image = false) => {
    let close: SyntaxNode | null = null
    for (let child = node.firstChild; child; child = child.nextSibling)
      if (child.name === 'LinkMark' && raw(child) === ']') {
        close = child
        break
      }
    if (!close) return escapePrintHtml(raw(node))
    const url = direct(node, 'URL'),
      label = direct(node, 'LinkLabel')
    const text = source.slice(node.from + (image ? 2 : 1), close.from)
    const ref = label ? raw(label).slice(1, -1) : ''
    const destination = url
      ? decodeMarkdownDestination(raw(url))
      : (references.get(normalizeMarkdownReferenceLabel(ref || text)) ?? '')
    if (image) return imageHtml(destination, decodeMarkdownText(text))
    const content = children(node, depth, true, node.from + 1, close.from)
    const href = safeHref(destination)
    return href ? `<a href="${escapePrintHtml(href)}">${content}</a>` : content
  }
  const imageHtml = (source: string, alt: string) => {
    if (!source) return escapePrintHtml(alt)
    if (images.length >= 64)
      throw new Error('Print up to 64 images at once, or choose source text.')
    const index = images.push({ source, alt }) - 1
    return `<img data-print-image="${index}" alt="${escapePrintHtml(alt)}">`
  }
  function render(node: SyntaxNode, depth: number): string {
    if (++visited > 100_000 || depth > 100)
      throw new Error(
        'This note is too complex to format for printing. Choose source text instead.',
      )
    const name = node.name
    if (
      /^(HeaderMark|QuoteMark|ListMark|EmphasisMark|StrikethroughMark|CodeMark|TableDelimiter|LinkReference)$/.test(
        name,
      )
    )
      return ''
    const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(name)
    if (heading) return `<h${heading[1]}>${children(node, depth).trim()}</h${heading[1]}>`
    switch (name) {
      case 'Document':
        return children(node, depth, false)
      case 'Paragraph':
        return `<p>${children(node, depth)}</p>`
      case 'StrongEmphasis':
        return `<strong>${children(node, depth)}</strong>`
      case 'Emphasis':
        return `<em>${children(node, depth)}</em>`
      case 'Strikethrough':
        return `<del>${children(node, depth)}</del>`
      case 'Blockquote':
        return `<blockquote>${children(node, depth, false)}</blockquote>`
      case 'BulletList':
        return `<ul>${children(node, depth, false)}</ul>`
      case 'OrderedList':
        return `<ol start="${Number.parseInt(raw(node), 10) || 1}">${children(node, depth, false)}</ol>`
      case 'ListItem':
        return `<li>${children(node, depth, false)}</li>`
      case 'Task':
        return `<p>${children(node, depth)}</p>`
      case 'TaskMarker':
        return /x/i.test(raw(node)) ? '<span class="task">☑</span>' : '<span class="task">☐</span>'
      case 'HorizontalRule':
        return '<hr>'
      case 'HardBreak':
        return '<br>'
      case 'InlineCode':
        return `<code>${escapePrintHtml(
          raw(node)
            .replace(/^(`+)([\s\S]*?)\1$/, '$2')
            .replace(/\n/g, ' '),
        )}</code>`
      case 'CodeBlock':
      case 'FencedCode': {
        let code = ''
        for (let child = node.firstChild; child; child = child.nextSibling)
          if (child.name === 'CodeText') code += raw(child)
        return `<pre><code>${escapePrintHtml(code)}</code></pre>`
      }
      case 'Table':
        return `<table>${children(node, depth, false)}</table>`
      case 'TableHeader':
        return `<thead><tr>${children(node, depth, false)}</tr></thead>`
      case 'TableRow':
        return `<tr>${children(node, depth, false)}</tr>`
      case 'TableCell': {
        const tag = node.parent?.name === 'TableHeader' ? 'th' : 'td'
        return `<${tag}>${children(node, depth)}</${tag}>`
      }
      case 'Link':
        return link(node, depth)
      case 'Image':
        return link(node, depth, true)
      case 'Autolink': {
        const text = raw(node).replace(/^<|>$/g, '')
        const href = safeHref(text.includes('@') && !text.includes(':') ? `mailto:${text}` : text)
        return href
          ? `<a href="${escapePrintHtml(href)}">${escapePrintHtml(text)}</a>`
          : escapePrintHtml(text)
      }
      case 'ObsidianImage': {
        const target = direct(node, 'ObsidianImageTarget'),
          alt = direct(node, 'ObsidianImageAlt')
        return imageHtml(
          target ? decodeMarkdownText(raw(target)) : '',
          alt ? decodeMarkdownText(raw(alt)) : '',
        )
      }
      case 'Escape':
      case 'Entity':
        return escapePrintHtml(decodeMarkdownText(raw(node)))
      case 'HTMLBlock':
      case 'HTMLTag':
        return escapePrintHtml(raw(node))
      default:
        return node.firstChild ? children(node, depth) : escapePrintHtml(raw(node))
    }
  }
  return { html: render(root, 0), images }
}
