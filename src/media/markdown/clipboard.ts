import { Annotation, StateEffect, StateField, type ChangeDesc } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

import { clipboardHtmlLooksStructured, clipboardHtmlToMarkdown } from '@/lib/extract-paste-data'

import type { MarkdownEditorRuntime } from './types'

type PendingImagePaste = {
  id: number
  anchor: number
  originalRanges: readonly PendingImagePasteRange[]
}

type PendingImagePasteRange = {
  from: number
  to: number
}

const addPendingImagePaste = StateEffect.define<PendingImagePaste>()
const removePendingImagePaste = StateEffect.define<number>()
export const clearPendingImagePastes = StateEffect.define<void>()
export const pendingImagePasteCompletion = Annotation.define<boolean>()
export const rawMarkdownPaste = Annotation.define<string>()

function mapOriginalRanges(
  ranges: readonly PendingImagePasteRange[],
  changes: ChangeDesc,
): readonly PendingImagePasteRange[] {
  if (changes.empty || ranges.length === 0) return ranges

  const mapped: PendingImagePasteRange[] = []
  changes.iterGaps((oldFrom, newFrom, length) => {
    const oldTo = oldFrom + length
    for (const range of ranges) {
      const from = Math.max(range.from, oldFrom)
      const to = Math.min(range.to, oldTo)
      if (from >= to) continue

      const next = {
        from: newFrom + from - oldFrom,
        to: newFrom + to - oldFrom,
      }
      const previous = mapped.at(-1)
      if (previous?.to === next.from) previous.to = next.to
      else mapped.push(next)
    }
  })
  return mapped
}

function completePendingImagePaste(
  pending: PendingImagePaste,
  markdown: string,
): readonly { from: number; to?: number; insert?: string }[] {
  const changes: { from: number; to?: number; insert?: string }[] = []
  let inserted = false

  for (const range of pending.originalRanges) {
    if (!inserted && pending.anchor >= range.from && pending.anchor <= range.to) {
      if (range.from < pending.anchor) {
        changes.push({ from: range.from, to: pending.anchor })
      }
      changes.push({ from: pending.anchor, to: range.to, insert: markdown })
      inserted = true
    } else {
      changes.push({ from: range.from, to: range.to })
    }
  }

  if (!inserted) changes.push({ from: pending.anchor, insert: markdown })
  return changes.sort((a, b) => a.from - b.from)
}

const pendingImagePastes = StateField.define<ReadonlyMap<number, PendingImagePaste>>({
  create: () => new Map(),
  update(value, transaction) {
    const next = new Map<number, PendingImagePaste>()
    for (const pending of value.values()) {
      next.set(pending.id, {
        id: pending.id,
        anchor: transaction.changes.mapPos(pending.anchor, -1),
        originalRanges: mapOriginalRanges(pending.originalRanges, transaction.changes),
      })
    }
    for (const effect of transaction.effects) {
      if (effect.is(addPendingImagePaste)) next.set(effect.value.id, effect.value)
      else if (effect.is(removePendingImagePaste)) next.delete(effect.value)
      else if (effect.is(clearPendingImagePastes)) next.clear()
    }
    return next
  },
})

let nextPendingImagePasteId = 0

export function insertClipboardText(view: EditorView, text: string): void {
  const selection = view.state.selection.main
  const inserted = view.state.toText(text)
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: inserted },
    selection: { anchor: selection.from + inserted.length },
    annotations: rawMarkdownPaste.of(text),
    userEvent: 'input.paste',
  })
}

function hasClipboardImage(event: ClipboardEvent): boolean {
  return Array.from(event.clipboardData?.items ?? []).some((item) => item.type.startsWith('image/'))
}

export function markdownClipboardExtension(runtime: MarkdownEditorRuntime) {
  return [
    pendingImagePastes,
    EditorView.domEventHandlers({
      paste(event, view) {
        if (view.state.readOnly) return false
        const clipboardEvent = event as ClipboardEvent
        const selection = view.state.selection.main

        if (hasClipboardImage(clipboardEvent) && runtime.onPasteImage) {
          const id = ++nextPendingImagePasteId
          let active = false
          let complete = false
          let queuedMarkdown: string | null | undefined
          const finish = (markdown: string | null): boolean => {
            if (complete) return false
            if (!active) {
              queuedMarkdown = markdown
              return true
            }
            complete = true
            if (!view.dom.isConnected) return false
            const pending = view.state.field(pendingImagePastes, false)?.get(id)
            if (!pending) return false
            if (markdown === null) {
              view.dispatch({ effects: removePendingImagePaste.of(id) })
              return true
            }
            view.dispatch({
              changes: completePendingImagePaste(pending, markdown),
              effects: removePendingImagePaste.of(id),
              annotations: pendingImagePasteCompletion.of(true),
              userEvent: 'input.paste',
              scrollIntoView: true,
            })
            return true
          }
          const result = runtime.onPasteImage(
            clipboardEvent,
            { from: selection.from, to: selection.to },
            finish,
          )
          const claimed = result === true || clipboardEvent.defaultPrevented
          if (claimed) {
            clipboardEvent.preventDefault()
            view.dispatch({
              selection: { anchor: selection.to },
              effects: addPendingImagePaste.of({
                id,
                anchor: selection.from,
                originalRanges:
                  selection.from === selection.to
                    ? []
                    : [{ from: selection.from, to: selection.to }],
              }),
            })
            active = true
            if (queuedMarkdown !== undefined) finish(queuedMarkdown)
            if (result instanceof Promise) {
              void result.then(
                (handled) => {
                  if (!handled) finish(null)
                },
                () => finish(null),
              )
            }
            return true
          }
          if (result instanceof Promise) void result.catch(() => {})
        }

        const html = clipboardEvent.clipboardData?.getData('text/html') ?? ''
        if (clipboardHtmlLooksStructured(html)) {
          const markdown = clipboardHtmlToMarkdown(html)
          if (markdown) {
            clipboardEvent.preventDefault()
            insertClipboardText(view, markdown)
            return true
          }
        }

        const plain = clipboardEvent.clipboardData?.getData('text/plain')
        if (plain !== undefined && plain !== '') {
          clipboardEvent.preventDefault()
          insertClipboardText(view, plain)
          return true
        }
        return false
      },
    }),
  ]
}
