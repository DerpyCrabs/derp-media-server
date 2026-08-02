import { EditorView } from '@codemirror/view'

export const markdownEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    minHeight: '100%',
    backgroundColor: 'transparent',
    color: 'var(--foreground)',
    fontFamily: 'var(--font-sans)',
    fontSize: '1rem',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    height: '100%',
    overflow: 'auto',
    fontFamily: 'var(--font-sans)',
    lineHeight: '1.75',
  },
  '.cm-content': {
    minHeight: '100%',
    padding: '0.5rem 0.75rem',
    caretColor: 'var(--foreground)',
  },
  '.cm-content[contenteditable="false"]': { caretColor: 'transparent' },
  '.cm-line': { padding: '0' },
  '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
  '.cm-selectionBackground': {
    backgroundColor: 'color-mix(in oklab, var(--primary) 20%, transparent)',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in oklab, var(--primary) 28%, transparent)',
  },
})
