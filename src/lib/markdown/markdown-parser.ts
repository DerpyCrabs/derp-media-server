import type { SyntaxNode } from '@lezer/common'
import { GFM, parser, type InlineContext, type MarkdownExtension } from '@lezer/markdown'
import { decodeHTMLStrict } from 'entities'

const imageExtension = /\.(?:png|jpe?g|gif|webp|svg|bmp|ico|tiff?|avif)$/i
const obsidianImageOpen = '![['
const obsidianImageClose = ']]'
const escapablePunctuation = /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])|&(?:#\d+|#x[a-f\d]+|\w+);/gi

export function decodeMarkdownText(value: string): string {
  return value.replace(
    escapablePunctuation,
    (token, escaped: string | undefined) => escaped ?? decodeHTMLStrict(token),
  )
}

export const obsidianImageExtension: MarkdownExtension = {
  defineNodes: ['ObsidianImage', 'ObsidianImageMark', 'ObsidianImageTarget', 'ObsidianImageAlt'],
  parseInline: [
    {
      name: 'ObsidianImage',
      before: 'Image',
      parse(cx: InlineContext, next: number, pos: number): number {
        if (next !== 33 || cx.char(pos + 1) !== 91 || cx.char(pos + 2) !== 91) {
          return -1
        }

        let close = -1
        for (let scan = pos + obsidianImageOpen.length; scan < cx.end - 1; scan += 1) {
          const char = cx.char(scan)
          if (char === 10 || char === 13) return -1
          if (char === 33 && cx.char(scan + 1) === 91 && cx.char(scan + 2) === 91) {
            return -1
          }
          if (char === 93 && cx.char(scan + 1) === 93) {
            close = scan
            break
          }
        }
        if (close < 0) return -1

        const rawInner = cx.slice(pos + obsidianImageOpen.length, close)
        const pipeOffset = rawInner.indexOf('|')
        const rawTarget = pipeOffset >= 0 ? rawInner.slice(0, pipeOffset) : rawInner
        const target = rawTarget.trim()
        if (!target || !imageExtension.test(decodeMarkdownText(target))) return -1

        const targetStart = pos + obsidianImageOpen.length + rawTarget.indexOf(target)
        const children = [
          cx.elt('ObsidianImageMark', pos, pos + obsidianImageOpen.length),
          cx.elt('ObsidianImageTarget', targetStart, targetStart + target.length),
        ]
        if (pipeOffset >= 0) {
          const altRaw = rawInner.slice(pipeOffset + 1)
          const alt = altRaw.trim()
          if (alt) {
            const altStart = pos + obsidianImageOpen.length + pipeOffset + 1 + altRaw.indexOf(alt)
            children.push(cx.elt('ObsidianImageAlt', altStart, altStart + alt.length))
          }
        }
        children.push(cx.elt('ObsidianImageMark', close, close + obsidianImageClose.length))
        return cx.addElement(
          cx.elt('ObsidianImage', pos, close + obsidianImageClose.length, children),
        )
      },
    },
  ],
}

export const markdownParser = parser.configure([GFM, obsidianImageExtension])

function directChild(node: SyntaxNode, name: string): SyntaxNode | null {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === name) return child
  }
  return null
}

function sourceFor(source: string, node: SyntaxNode): string {
  return source.slice(node.from, node.to)
}

function referenceLabelText(source: string, node: SyntaxNode): string {
  const label = sourceFor(source, node)
  return label.startsWith('[') && label.endsWith(']') ? label.slice(1, -1) : label
}

type MarkdownSourceSlice = (from: number, to: number) => string

function slicedReferenceLabelText(slice: MarkdownSourceSlice, node: SyntaxNode): string {
  const label = slice(node.from, node.to)
  return label.startsWith('[') && label.endsWith(']') ? label.slice(1, -1) : label
}

export function normalizeMarkdownReferenceLabel(label: string): string {
  return decodeMarkdownText(label).trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase()
}

export function decodeMarkdownDestination(value: string): string {
  return decodeMarkdownText(value.trim().replace(/^<([\s\S]*)>$/, '$1')).trim()
}

export function collectMarkdownReferenceDefinitions(
  root: SyntaxNode,
  slice: MarkdownSourceSlice,
): Map<string, string> {
  const definitions = new Map<string, string>()
  const cursor = root.cursor()
  while (true) {
    if (cursor.name === 'LinkReference') {
      const node = cursor.node
      const label = directChild(node, 'LinkLabel')
      const url = directChild(node, 'URL')
      if (label && url) {
        const normalized = normalizeMarkdownReferenceLabel(slicedReferenceLabelText(slice, label))
        const destination = decodeMarkdownDestination(slice(url.from, url.to))
        if (normalized && destination && !definitions.has(normalized)) {
          definitions.set(normalized, destination)
        }
      }
    }
    if (cursor.firstChild()) continue
    while (!cursor.nextSibling()) {
      if (!cursor.parent()) return definitions
    }
  }
}

function allNodesNamed(root: SyntaxNode, name: string): SyntaxNode[] {
  const nodes: SyntaxNode[] = []
  const cursor = root.cursor()
  while (true) {
    if (cursor.name === name) nodes.push(cursor.node)
    if (cursor.firstChild()) continue
    while (!cursor.nextSibling()) {
      if (!cursor.parent()) return nodes
    }
  }
}

export function collectMarkdownImageTargets(source: string): string[] {
  const root = markdownParser.parse(source).topNode
  const definitions = collectMarkdownReferenceDefinitions(root, (from, to) =>
    source.slice(from, to),
  )

  const targets = new Set<string>()
  for (const image of allNodesNamed(root, 'Image')) {
    const inlineUrl = directChild(image, 'URL')
    let target = inlineUrl ? decodeMarkdownDestination(sourceFor(source, inlineUrl)) : ''
    if (!target) {
      const closingLabel = allNodesNamed(image, 'LinkMark').find(
        (mark) => sourceFor(source, mark) === ']',
      )
      const reference = directChild(image, 'LinkLabel')
      if (!closingLabel) continue
      const explicitLabel = reference ? referenceLabelText(source, reference) : ''
      const visibleLabel = source.slice(image.from + 2, closingLabel.from)
      target = definitions.get(normalizeMarkdownReferenceLabel(explicitLabel || visibleLabel)) ?? ''
    }
    if (target) targets.add(target)
  }
  for (const image of allNodesNamed(root, 'ObsidianImage')) {
    const target = directChild(image, 'ObsidianImageTarget')
    if (target) targets.add(decodeMarkdownText(sourceFor(source, target)))
  }
  return [...targets]
}
