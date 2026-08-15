import { syntaxTree } from '@codemirror/language'
import { Facet, StateEffect, StateField, type EditorState, type Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import type { SyntaxNode, SyntaxNodeRef } from '@lezer/common'

import { decodeMarkdownText } from '@/lib/markdown/markdown-parser'
import { MarkdownImageWidget, extractObsidianImage, extractStandardImage } from './images'
import {
  createMarkdownReferenceResolver,
  extractMarkdownLink,
  markdownLinkAttributes,
  type MarkdownReferenceResolver,
} from './links'
import { TaskCheckboxWidget } from './task-lists'
import type { MarkdownEditorRuntime, MarkdownMode } from './types'

export const markdownModeFacet = Facet.define<MarkdownMode, MarkdownMode>({
  combine: (values) => values[0] ?? 'read',
})

export const refreshMarkdownPreview = StateEffect.define<void>()

const revealNodeNames = new Set([
  'ATXHeading1',
  'ATXHeading2',
  'ATXHeading3',
  'ATXHeading4',
  'ATXHeading5',
  'ATXHeading6',
  'SetextHeading1',
  'SetextHeading2',
  'StrongEmphasis',
  'Emphasis',
  'Strikethrough',
  'Link',
  'Autolink',
  'URL',
  'LinkReference',
  'Image',
  'ObsidianImage',
  'ListItem',
  'Task',
  'Blockquote',
  'HorizontalRule',
  'InlineCode',
  'FencedCode',
  'Table',
  'Escape',
  'Entity',
  'HardBreak',
])

function revealNode(node: SyntaxNode): SyntaxNode {
  let current: SyntaxNode | null = node
  while (current?.parent && !revealNodeNames.has(current.name)) current = current.parent
  return current && revealNodeNames.has(current.name) ? current : node
}

export function syntaxNodeIsActive(state: EditorState, node: SyntaxNode): boolean {
  if (state.facet(markdownModeFacet) !== 'edit') return false
  const target = revealNode(node)
  return state.selection.ranges.some((selection) =>
    selection.empty
      ? selection.head >= target.from && selection.head <= target.to
      : selection.from < target.to && selection.to > target.from,
  )
}

class MarkdownMarkerWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly className: string,
  ) {
    super()
  }

  eq(other: MarkdownMarkerWidget): boolean {
    return other.text === this.text && other.className === this.className
  }

  toDOM(): HTMLElement {
    const marker = document.createElement('span')
    marker.className = this.className
    marker.textContent = this.text
    marker.setAttribute('aria-hidden', 'true')
    return marker
  }
}

class MarkdownTextWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly className = '',
  ) {
    super()
  }

  eq(other: MarkdownTextWidget): boolean {
    return other.text === this.text && other.className === this.className
  }

  toDOM(): HTMLElement {
    const text = document.createElement('span')
    if (this.className) text.className = this.className
    text.textContent = this.text
    return text
  }
}

class HorizontalRuleWidget extends WidgetType {
  eq(other: HorizontalRuleWidget): boolean {
    return other instanceof HorizontalRuleWidget
  }

  toDOM(): HTMLElement {
    const rule = document.createElement('span')
    rule.className = 'cm-md-horizontal-rule'
    rule.setAttribute('role', 'separator')
    return rule
  }
}

function blockLines(
  state: EditorState,
  from: number,
  to: number,
  visibleFrom: number,
  visibleTo: number,
): number[] {
  const starts: number[] = []
  const boundedFrom = Math.max(from, visibleFrom)
  const boundedTo = Math.min(to, visibleTo)
  if (boundedFrom > boundedTo) return starts
  let line = state.doc.lineAt(boundedFrom)
  while (line.from <= boundedTo) {
    starts.push(line.from)
    if (line.number >= state.doc.lines || line.to >= boundedTo) break
    line = state.doc.line(line.number + 1)
  }
  return starts
}

function normalizedInlineCode(state: EditorState, node: SyntaxNode): string | null {
  const open = node.firstChild
  const close = node.lastChild
  if (!open || !close || open.name !== 'CodeMark' || close.name !== 'CodeMark') return null
  let content = state.sliceDoc(open.to, close.from).replace(/\r?\n/g, ' ')
  if (content.startsWith(' ') && content.endsWith(' ') && /[^ ]/.test(content)) {
    content = content.slice(1, -1)
  }
  return content
}

function inlineCodeIsMultiline(state: EditorState, node: SyntaxNode): boolean {
  return state.sliceDoc(node.from, node.to).includes('\n')
}

function buildReadMultilineCodeDecorations(state: EditorState): DecorationSet {
  if (state.facet(markdownModeFacet) !== 'read') return Decoration.none
  const ranges: Range<Decoration>[] = []
  syntaxTree(state).iterate({
    enter(ref) {
      if (ref.name !== 'InlineCode' || !inlineCodeIsMultiline(state, ref.node)) return
      const rendered = normalizedInlineCode(state, ref.node)
      if (rendered !== null) {
        ranges.push(
          Decoration.replace({
            widget: new MarkdownTextWidget(rendered, 'cm-md-inline-code'),
          }).range(ref.from, ref.to),
        )
      }
      return false
    },
  })
  return Decoration.set(ranges, true)
}

const readMultilineCodeDecorations = StateField.define<DecorationSet>({
  create: buildReadMultilineCodeDecorations,
  update(decorations, transaction) {
    const modeChanged =
      transaction.startState.facet(markdownModeFacet) !== transaction.state.facet(markdownModeFacet)
    if (transaction.docChanged || modeChanged) {
      return buildReadMultilineCodeDecorations(transaction.state)
    }
    return decorations
  },
  provide: (field) => EditorView.decorations.from(field),
})

function rangeContainsReference(root: SyntaxNode, from: number, to: number): boolean {
  let found = false
  root.tree?.iterate({
    from,
    to,
    enter(ref) {
      if (ref.name !== 'LinkReference') return !found
      found = true
      return false
    },
  })
  return found
}

function changedLinesContainReference(
  state: EditorState,
  root: SyntaxNode,
  from: number,
  to: number,
): boolean {
  const boundedFrom = Math.min(from, state.doc.length)
  const boundedTo = Math.min(to, state.doc.length)
  const first = state.doc.lineAt(boundedFrom)
  const last = state.doc.lineAt(boundedTo)
  return rangeContainsReference(root, first.from, last.to)
}

function markdownReferencesChanged(
  update: ViewUpdate,
  previousRoot: SyntaxNode,
  nextRoot: SyntaxNode,
): boolean {
  let changed = false
  update.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (changed) return
    changed =
      changedLinesContainReference(update.startState, previousRoot, fromA, toA) ||
      changedLinesContainReference(update.state, nextRoot, fromB, toB)
  })
  return changed
}

function buildDecorations(
  view: EditorView,
  runtime: MarkdownEditorRuntime,
  resolveReference: MarkdownReferenceResolver,
): DecorationSet {
  const state = view.state
  const mode = state.facet(markdownModeFacet)
  const ranges: Range<Decoration>[] = []
  const seen = new Set<string>()

  const add = (decoration: Decoration, from: number, to?: number, kind = '') => {
    const key = `${from}:${to ?? from}:${kind}`
    if (seen.has(key)) return
    seen.add(key)
    ranges.push(to === undefined ? decoration.range(from) : decoration.range(from, to))
  }
  const hide = (from: number, to: number, kind: string) => {
    if (from < to) add(Decoration.replace({}), from, to, `hide-${kind}`)
  }
  const mark = (
    from: number,
    to: number,
    className: string,
    attributes?: Record<string, string>,
    tagName?: string,
  ) => {
    if (from < to) {
      add(Decoration.mark({ class: className, attributes, tagName }), from, to, `mark-${className}`)
    }
  }

  for (const visible of view.visibleRanges) {
    syntaxTree(state).iterate({
      from: visible.from,
      to: visible.to,
      enter(ref: SyntaxNodeRef): boolean | void {
        const node = ref.node
        const active = syntaxNodeIsActive(state, node)

        if (node.name === 'Entity') {
          if (!active) {
            const source = state.sliceDoc(node.from, node.to)
            const decoded = decodeMarkdownText(source)
            if (decoded !== source) {
              add(
                Decoration.replace({ widget: new MarkdownTextWidget(decoded) }),
                node.from,
                node.to,
                `entity-${decoded}`,
              )
            }
          }
          return false
        }

        if (node.name === 'HardBreak') {
          if (!active) {
            hide(node.from, Math.max(node.from, node.to - 1), `hard-break-${node.from}`)
          }
          return false
        }

        if (node.name === 'LinkReference') {
          if (!active) {
            hide(node.from, node.to, `link-reference-${node.from}`)
            add(
              Decoration.line({ class: 'cm-md-reference-line' }),
              state.doc.lineAt(node.from).from,
              undefined,
              'link-reference-line',
            )
          }
          return false
        }

        if (node.name === 'Image' || node.name === 'ObsidianImage') {
          const image =
            node.name === 'Image'
              ? extractStandardImage(node, state.doc, resolveReference)
              : extractObsidianImage(node, state.doc)
          if (!image) return false
          if (active) {
            mark(node.from, node.to, 'cm-md-image-source')
            return false
          }
          const resolved = runtime.resolveImageUrl(image.src)
          if (resolved) {
            add(
              Decoration.replace({
                widget: new MarkdownImageWidget(image, resolved, mode, runtime),
              }),
              node.from,
              node.to,
              `image-${resolved}-${mode}`,
            )
          } else {
            mark(node.from, node.to, 'cm-md-source-fallback')
          }
          return false
        }

        if (node.name === 'Link' || node.name === 'Autolink' || node.name === 'URL') {
          const link = extractMarkdownLink(node, state.doc, resolveReference)
          if (!link) return
          const attributes = markdownLinkAttributes(link, mode === 'read')
          mark(
            link.labelFrom,
            link.labelTo,
            `cm-md-link${active ? ' cm-md-link-active' : ''}`,
            attributes,
            mode === 'read' && 'href' in attributes ? 'a' : undefined,
          )
          if (!active) {
            hide(link.from, link.labelFrom, `link-open-${link.from}`)
            hide(link.labelTo, link.to, `link-close-${link.from}`)
          }
        }

        if (/^ATXHeading[1-6]$/.test(node.name)) {
          const level = node.name.slice(-1)
          for (const lineFrom of blockLines(state, node.from, node.to, visible.from, visible.to)) {
            add(
              Decoration.line({ class: `cm-md-heading-line cm-md-heading-${level}` }),
              lineFrom,
              undefined,
              `heading-line-${level}`,
            )
          }
          mark(node.from, node.to, `cm-md-heading-content cm-md-heading-content-${level}`)
        } else if (node.name === 'SetextHeading1' || node.name === 'SetextHeading2') {
          const level = node.name.endsWith('1') ? '1' : '2'
          const marker = node.getChild('HeaderMark')
          const markerLine = marker ? state.doc.lineAt(marker.from) : null
          const contentTo = markerLine ? Math.max(node.from, markerLine.from - 1) : node.to
          for (const lineFrom of blockLines(
            state,
            node.from,
            contentTo,
            visible.from,
            visible.to,
          )) {
            add(
              Decoration.line({ class: `cm-md-heading-line cm-md-heading-${level}` }),
              lineFrom,
              undefined,
              `setext-content-${level}`,
            )
          }
          mark(
            node.from,
            markerLine?.from ?? node.to,
            `cm-md-heading-content cm-md-heading-content-${level}`,
          )
          if (marker && !active) {
            add(
              Decoration.line({ class: 'cm-md-setext-marker-line' }),
              state.doc.lineAt(marker.from).from,
              undefined,
              'setext-marker-line',
            )
          }
        }

        if (node.name === 'StrongEmphasis') mark(node.from, node.to, 'cm-md-strong')
        else if (node.name === 'Emphasis') mark(node.from, node.to, 'cm-md-emphasis')
        else if (node.name === 'Strikethrough') mark(node.from, node.to, 'cm-md-strikethrough')
        else if (node.name === 'InlineCode') {
          const multiline = inlineCodeIsMultiline(state, node)
          if (multiline) {
            if (mode === 'edit') mark(node.from, node.to, 'cm-md-inline-code')
            return false
          }
          if (!active) {
            const rendered = normalizedInlineCode(state, node)
            if (rendered !== null) {
              add(
                Decoration.replace({
                  widget: new MarkdownTextWidget(rendered, 'cm-md-inline-code'),
                }),
                node.from,
                node.to,
                `inline-code-${rendered}`,
              )
              return false
            }
          }
          mark(node.from, node.to, 'cm-md-inline-code')
        }

        if (
          node.name === 'EmphasisMark' ||
          node.name === 'StrikethroughMark' ||
          node.name === 'CodeMark'
        ) {
          if (!active) hide(node.from, node.to, `${node.name}-${node.from}`)
        } else if (node.name === 'HeaderMark' && !active) {
          let to = node.to
          while (to < state.doc.length && /[ \t]/.test(state.sliceDoc(to, to + 1))) to += 1
          hide(node.from, to, `heading-${node.from}`)
        } else if (node.name === 'Escape' && !active) {
          hide(node.from, Math.min(node.from + 1, node.to), `escape-${node.from}`)
        }

        if (node.name === 'ListItem') {
          for (const lineFrom of blockLines(state, node.from, node.to, visible.from, visible.to)) {
            add(Decoration.line({ class: 'cm-md-list-line' }), lineFrom, undefined, 'list-line')
          }
        } else if (node.name === 'ListMark' && !active) {
          const source = state.sliceDoc(node.from, node.to)
          const text = /^[-+*]$/.test(source) ? '•' : source
          add(
            Decoration.replace({ widget: new MarkdownMarkerWidget(text, 'cm-md-list-marker') }),
            node.from,
            node.to,
            `list-mark-${node.from}`,
          )
        } else if (node.name === 'TaskMarker' && !active) {
          const marker = state.sliceDoc(node.from, node.to)
          if (/^\[[ xX]\]$/.test(marker)) {
            add(
              Decoration.replace({ widget: new TaskCheckboxWidget(node.from, marker, mode) }),
              node.from,
              node.to,
              `task-${node.from}-${marker}-${mode}`,
            )
          }
        }

        if (node.name === 'Blockquote') {
          for (const lineFrom of blockLines(state, node.from, node.to, visible.from, visible.to)) {
            add(
              Decoration.line({ class: 'cm-md-blockquote-line' }),
              lineFrom,
              undefined,
              'blockquote-line',
            )
          }
        } else if (node.name === 'QuoteMark' && !active) {
          let to = node.to
          if (state.sliceDoc(to, to + 1) === ' ') to += 1
          hide(node.from, to, `quote-${node.from}`)
        }

        if (node.name === 'HorizontalRule' && !active) {
          add(
            Decoration.replace({ widget: new HorizontalRuleWidget() }),
            node.from,
            node.to,
            `rule-${node.from}`,
          )
          return false
        }

        if (node.name === 'FencedCode') {
          for (const lineFrom of blockLines(state, node.from, node.to, visible.from, visible.to)) {
            add(
              Decoration.line({ class: 'cm-md-code-block-line' }),
              lineFrom,
              undefined,
              'code-line',
            )
          }
        } else if (node.name === 'CodeInfo' && !active) {
          hide(node.from, node.to, `code-info-${node.from}`)
        }

        if (node.name === 'TableHeader' || node.name === 'TableRow') {
          add(
            Decoration.line({
              class: node.name === 'TableHeader' ? 'cm-md-table-header' : 'cm-md-table-row',
            }),
            state.doc.lineAt(node.from).from,
            undefined,
            `table-line-${node.name}`,
          )
        } else if (node.name === 'TableCell') {
          mark(node.from, node.to, 'cm-md-table-cell')
        } else if (node.name === 'TableDelimiter' && !active) {
          const source = state.sliceDoc(node.from, node.to)
          if (/^\|?\s*:?-+/.test(source)) {
            hide(node.from, node.to, `table-rule-${node.from}`)
            add(
              Decoration.line({ class: 'cm-md-table-separator' }),
              state.doc.lineAt(node.from).from,
              undefined,
              'table-separator-line',
            )
          } else {
            hide(node.from, node.to, `table-pipe-${node.from}`)
          }
        }

        if (node.name === 'HTMLTag' || node.name === 'HTMLBlock') {
          mark(node.from, node.to, 'cm-md-inert-html')
        }
      },
    })
  }

  return Decoration.set(ranges, true)
}

export function livePreviewExtension(runtime: MarkdownEditorRuntime) {
  return [
    readMultilineCodeDecorations,
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet
        referenceRoot: SyntaxNode
        resolveReference: MarkdownReferenceResolver

        constructor(view: EditorView) {
          this.referenceRoot = syntaxTree(view.state).topNode
          this.resolveReference = createMarkdownReferenceResolver(
            this.referenceRoot,
            view.state.doc,
          )
          this.decorations = buildDecorations(view, runtime, this.resolveReference)
        }

        update(update: ViewUpdate): void {
          const previousRoot = this.referenceRoot
          const referenceRoot = syntaxTree(update.state).topNode
          const syntaxTreeChanged = referenceRoot.tree !== previousRoot.tree
          this.referenceRoot = referenceRoot
          if (
            (!update.docChanged && syntaxTreeChanged) ||
            (update.docChanged && markdownReferencesChanged(update, previousRoot, referenceRoot))
          ) {
            this.resolveReference = createMarkdownReferenceResolver(referenceRoot, update.state.doc)
          }
          const modeChanged =
            update.startState.facet(markdownModeFacet) !== update.state.facet(markdownModeFacet)
          const refreshRequested = update.transactions.some((transaction) =>
            transaction.effects.some((effect) => effect.is(refreshMarkdownPreview)),
          )
          if (
            update.docChanged ||
            update.selectionSet ||
            update.viewportChanged ||
            syntaxTreeChanged ||
            modeChanged ||
            refreshRequested
          ) {
            this.decorations = buildDecorations(update.view, runtime, this.resolveReference)
          }
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
  ]
}
