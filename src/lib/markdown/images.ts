import type { SyntaxNode } from '@lezer/common'
import type { Text } from '@codemirror/state'
import { EditorView, WidgetType } from '@codemirror/view'

import { decodeMarkdownDestination, decodeMarkdownText } from '@/lib/markdown/markdown-parser'
import type { MarkdownReferenceResolver } from './links'
import type { MarkdownEditorRuntime, MarkdownMode } from './types'

export type MarkdownImage = {
  from: number
  to: number
  src: string
  alt: string
  syntax: 'standard' | 'obsidian'
}

type MarkdownImageActivation = {
  src: string
  alt: string
}

const markdownImageActivations = new WeakMap<EditorView, MarkdownImageActivation>()

export function clearMarkdownImageActivation(view: EditorView): void {
  markdownImageActivations.delete(view)
}

export function openActivatedMarkdownImage(
  view: EditorView,
  runtime: MarkdownEditorRuntime,
): boolean {
  const activation = markdownImageActivations.get(view)
  if (!activation) return false
  markdownImageActivations.delete(view)
  runtime.openImage(activation.src, activation.alt)
  return true
}

function directChild(node: SyntaxNode, name: string): SyntaxNode | null {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === name) return child
  }
  return null
}

type MarkdownTextReplacement = {
  from: number
  to: number
  text: string
}

function inlineCodeText(node: SyntaxNode, doc: Text): string {
  const open = node.firstChild
  const close = node.lastChild
  if (!open || !close || open.name !== 'CodeMark' || close.name !== 'CodeMark') {
    return doc.sliceString(node.from, node.to)
  }
  let content = doc.sliceString(open.to, close.from).replace(/\r?\n/g, ' ')
  if (content.startsWith(' ') && content.endsWith(' ') && /[^ ]/.test(content)) {
    content = content.slice(1, -1)
  }
  return content
}

function imageAltText(node: SyntaxNode, doc: Text, from: number, to: number): string {
  const replacements: MarkdownTextReplacement[] = []

  const visit = (current: SyntaxNode) => {
    if (current.to <= from || current.from >= to) return
    if (current.name === 'Entity' || current.name === 'Escape') {
      replacements.push({
        from: current.from,
        to: current.to,
        text: decodeMarkdownText(doc.sliceString(current.from, current.to)),
      })
      return
    }
    if (current.name === 'InlineCode') {
      replacements.push({ from: current.from, to: current.to, text: inlineCodeText(current, doc) })
      return
    }
    if (
      current.name.endsWith('Mark') ||
      current.name === 'LinkLabel' ||
      current.name === 'LinkTitle' ||
      (current.name === 'URL' &&
        (current.parent?.name === 'Link' || current.parent?.name === 'Image'))
    ) {
      replacements.push({ from: current.from, to: current.to, text: '' })
      return
    }
    for (let child = current.firstChild; child; child = child.nextSibling) visit(child)
  }

  for (let child = node.firstChild; child; child = child.nextSibling) visit(child)
  replacements.sort((left, right) => left.from - right.from || right.to - left.to)

  let cursor = from
  let result = ''
  for (const replacement of replacements) {
    if (replacement.from < cursor || replacement.from < from || replacement.to > to) continue
    result += doc.sliceString(cursor, replacement.from) + replacement.text
    cursor = replacement.to
  }
  return result + doc.sliceString(cursor, to)
}

export function extractStandardImage(
  node: SyntaxNode,
  doc: Text,
  resolveReference?: MarkdownReferenceResolver,
): MarkdownImage | null {
  if (node.name !== 'Image') return null
  const urlNode = directChild(node, 'URL')

  let closingLabel: SyntaxNode | null = null
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'LinkMark' && doc.sliceString(child.from, child.to) === ']') {
      closingLabel = child
      break
    }
  }
  if (!closingLabel) return null

  const alt = imageAltText(node, doc, node.from + 2, closingLabel.from)
  let src = urlNode
    ? decodeMarkdownDestination(doc.sliceString(urlNode.from, urlNode.to))
    : undefined
  if (!src && resolveReference) {
    const reference = directChild(node, 'LinkLabel')
    const referenceText = reference ? doc.sliceString(reference.from + 1, reference.to - 1) : ''
    src = resolveReference(referenceText || doc.sliceString(node.from + 2, closingLabel.from))
  }
  if (!src) return null
  return {
    from: node.from,
    to: node.to,
    src,
    alt,
    syntax: 'standard',
  }
}

export function extractObsidianImage(node: SyntaxNode, doc: Text): MarkdownImage | null {
  if (node.name !== 'ObsidianImage') return null
  const target = directChild(node, 'ObsidianImageTarget')
  if (!target) return null
  const altNode = directChild(node, 'ObsidianImageAlt')
  const src = decodeMarkdownText(doc.sliceString(target.from, target.to))
  return {
    from: node.from,
    to: node.to,
    src,
    alt: altNode ? decodeMarkdownText(doc.sliceString(altNode.from, altNode.to)) : src,
    syntax: 'obsidian',
  }
}

export class MarkdownImageWidget extends WidgetType {
  constructor(
    readonly image: MarkdownImage,
    readonly resolvedSrc: string,
    readonly mode: MarkdownMode,
    readonly runtime: MarkdownEditorRuntime,
  ) {
    super()
  }

  eq(other: MarkdownImageWidget): boolean {
    return (
      other.image.from === this.image.from &&
      other.image.to === this.image.to &&
      other.image.src === this.image.src &&
      other.image.alt === this.image.alt &&
      other.image.syntax === this.image.syntax &&
      other.resolvedSrc === this.resolvedSrc &&
      other.mode === this.mode
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const image = document.createElement('img')
    image.src = this.resolvedSrc
    image.alt = this.image.alt
    image.loading = 'lazy'
    image.draggable = false
    image.tabIndex = 0
    image.className = 'cm-md-image'
    image.dataset.markdownImage = this.image.syntax
    image.setAttribute('role', 'button')
    image.setAttribute(
      'aria-label',
      `${this.image.alt || 'Markdown image'}; ${this.mode === 'read' ? 'open fullscreen' : 'select source'}`,
    )

    const selectSource = () => {
      view.dispatch({
        selection: { anchor: this.image.from, head: this.image.to },
        scrollIntoView: true,
        userEvent: 'select.pointer',
      })
      view.focus()
    }

    image.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (this.mode === 'read') {
        this.runtime.openImage(this.resolvedSrc, this.image.alt)
        return
      }
      markdownImageActivations.set(view, {
        src: this.resolvedSrc,
        alt: this.image.alt,
      })
      selectSource()
    })

    image.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      event.stopPropagation()
      if (this.mode === 'read') this.runtime.openImage(this.resolvedSrc, this.image.alt)
      else selectSource()
    })
    return image
  }

  ignoreEvent(): boolean {
    return true
  }
}
