import { createCodeSearchPanel } from '@/lib/editor/CodeSearchPanel'
import { search, searchKeymap } from '@codemirror/search'
import {
  detectLineSeparator,
  hasMixedLineEndings,
  sourceState as markdownSourceState,
  replaceSource as replaceMarkdownSource,
  sourceTrackingExtensions,
  selectionText,
} from '@/lib/editor/source'
import { modelOwner } from 'effectweb'
import { history, historyKeymap, standardKeymap } from '@codemirror/commands'
import {
  Annotation,
  Compartment,
  EditorState,
  Transaction,
  type Extension,
} from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'

import { indentMarkdownList, continueMarkdownList, toggleMarkdownDelimiter } from './commands'
import {
  clearPendingImagePastes,
  markdownClipboardExtension,
  pendingImagePasteCompletion,
} from './clipboard'
import { clearMarkdownImageActivation, openActivatedMarkdownImage } from './images'
import { markdownLanguage } from './markdown-language'
import { livePreviewExtension, markdownModeFacet, refreshMarkdownPreview } from './live-preview'
import { markdownLinkInteractionExtension } from './links'
import { markdownEditorTheme } from './theme'
import type { MarkdownEditorRuntime, MarkdownMode } from './types'

export const externalMarkdownUpdate = Annotation.define<boolean>()

type CreateMarkdownEditorOptions = {
  parent: HTMLElement
  doc: string
  mode: MarkdownMode
  ariaLabel: string
  runtime: MarkdownEditorRuntime
}

export type MarkdownEditorController = {
  view: EditorView
  setMode: (mode: MarkdownMode, ariaLabel: string) => void
  setContent: (content: string) => void
  refresh: () => void
  destroy: () => void
}

function modeExtensions(mode: MarkdownMode, ariaLabel: string): Extension {
  const readOnly = mode === 'read'
  return [
    markdownModeFacet.of(mode),
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(true),
    EditorView.contentAttributes.of({
      role: readOnly ? 'document' : 'textbox',
      'aria-label': ariaLabel,
      'aria-readonly': readOnly ? 'true' : 'false',
      'aria-multiline': 'true',
      tabindex: '0',
      spellcheck: 'false',
    }),
  ]
}

export function createMarkdownEditor(
  options: CreateMarkdownEditorOptions,
): MarkdownEditorController {
  const commands = modelOwner({})
  const saveSlot = 'markdown-save'
  const pasteSlot = 'markdown-paste-image'

  const modeCompartment = new Compartment()
  const historyCompartment = new Compartment()
  const runtime = options.runtime

  const state = EditorState.create({
    doc: options.doc,
    extensions: [
      markdownLanguage,
      markdownEditorTheme,
      search({ top: true, createPanel: createCodeSearchPanel }),
      EditorView.lineWrapping,
      EditorState.tabSize.of(2),
      sourceTrackingExtensions(options.doc),
      historyCompartment.of(history()),
      modeCompartment.of(modeExtensions(options.mode, options.ariaLabel)),
      EditorState.transactionFilter.of((transaction) => {
        if (
          transaction.docChanged &&
          transaction.startState.readOnly &&
          !transaction.annotation(externalMarkdownUpdate) &&
          !transaction.annotation(pendingImagePasteCompletion)
        ) {
          return []
        }
        return transaction
      }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return
        clearMarkdownImageActivation(update.view)
        let changedLocally = false
        for (const transaction of update.transactions) {
          if (!transaction.docChanged || transaction.annotation(externalMarkdownUpdate)) continue
          changedLocally = true
        }
        if (changedLocally) runtime.onChange?.(update.state.field(markdownSourceState).text)
      }),
      livePreviewExtension(runtime),
      markdownClipboardExtension(runtime, (work) => commands.run(pasteSlot, work, 'parallel')),
      markdownLinkInteractionExtension(),
      EditorView.domEventHandlers({
        mousedown(event, view) {
          const target = event.target
          if (
            event.detail < 2 &&
            (!(target instanceof Element) || !target.closest('img.cm-md-image'))
          ) {
            clearMarkdownImageActivation(view)
          }
          return false
        },
        dblclick(event, view) {
          if (!openActivatedMarkdownImage(view, runtime)) return false
          event.preventDefault()
          event.stopPropagation()
          return true
        },
        blur(event, view) {
          if (!(event.relatedTarget instanceof Node) || !view.dom.contains(event.relatedTarget)) {
            runtime.onBlur?.()
          }
          return false
        },
        copy(event, view) {
          if (!view.state.readOnly) return false
          const source = view.state.field(markdownSourceState)
          const text = selectionText(view, source.text, source.lineSeparator)
          if (!text || !event.clipboardData) return false
          event.clipboardData.setData('text/plain', text)
          event.preventDefault()
          return true
        },
        keydown(event, view) {
          clearMarkdownImageActivation(view)
          if (
            event.key === 'ArrowLeft' ||
            event.key === 'ArrowRight' ||
            event.key === 'ArrowUp' ||
            event.key === 'ArrowDown' ||
            event.key === 'Home' ||
            event.key === 'End' ||
            event.key === 'PageUp' ||
            event.key === 'PageDown' ||
            ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')
          ) {
            event.stopPropagation()
          }
          return false
        },
      }),
      keymap.of([
        {
          key: 'Mod-s',
          preventDefault: true,
          run: (view) => {
            if (view.state.readOnly) return false
            if (runtime.onSave) void commands.run(saveSlot, runtime.onSave(), 'latest-queued')
            return true
          },
        },
        { key: 'Mod-b', run: toggleMarkdownDelimiter('**') },
        { key: 'Mod-i', run: toggleMarkdownDelimiter('*') },
        { key: 'Enter', run: continueMarkdownList },
        {
          key: 'Tab',
          run: (view) => (view.state.readOnly ? false : indentMarkdownList(false)(view)),
          shift: (view) => (view.state.readOnly ? false : indentMarkdownList(true)(view)),
        },
        ...searchKeymap,
        ...historyKeymap,
        ...standardKeymap,
      ]),
    ],
  })

  const view = new EditorView({ state, parent: options.parent })

  return {
    view,
    setMode(mode, ariaLabel) {
      clearMarkdownImageActivation(view)
      view.dispatch({ effects: modeCompartment.reconfigure(modeExtensions(mode, ariaLabel)) })
    },
    setContent(content) {
      const previousSource = view.state.field(markdownSourceState)
      if (content === previousSource.text) return
      clearMarkdownImageActivation(view)
      const document = view.state.toText(content)
      const selection = view.state.selection.main
      const anchor = Math.min(selection.anchor, document.length)
      const head = Math.min(selection.head, document.length)
      const replaceDocument = !document.eq(view.state.doc)
      view.dispatch({
        ...(replaceDocument
          ? {
              changes: { from: 0, to: view.state.doc.length, insert: document },
              selection: { anchor, head },
            }
          : {}),
        effects: [
          clearPendingImagePastes.of(undefined),
          historyCompartment.reconfigure([]),
          replaceMarkdownSource.of({
            text: content,
            lineSeparator: detectLineSeparator(content, previousSource.lineSeparator),
            mixedLineEndings: hasMixedLineEndings(content),
          }),
        ],
        annotations: [
          externalMarkdownUpdate.of(true),
          Transaction.addToHistory.of(false),
          Transaction.userEvent.of('sync.external'),
        ],
      })
      view.dispatch({ effects: historyCompartment.reconfigure(history()) })
    },
    refresh() {
      view.dispatch({ effects: refreshMarkdownPreview.of(undefined) })
    },
    destroy() {
      commands.dispose()
      clearMarkdownImageActivation(view)
      view.destroy()
    },
  }
}
