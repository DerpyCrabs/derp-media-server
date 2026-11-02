import { detectLineSeparator, hasMixedLineEndings } from './source'
import { modelOwner } from 'effectweb'
import {
  codeLanguages,
  detectCodeLanguage,
  detectIndentation,
  type CodeLanguage,
} from './code-languages'
import type { PlainTextDocumentProps } from './PlainTextDocument'
const lineEndingLabel = (text: string) =>
  hasMixedLineEndings(text)
    ? 'Mixed endings'
    : detectLineSeparator(text) === '\r\n'
      ? 'CRLF'
      : detectLineSeparator(text) === '\r'
        ? 'CR'
        : 'LF'
const displayKey = 'derp.textEditor.display'
function readDisplay(): { wrap?: boolean; numbers?: boolean } {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(displayKey) ?? '{}')
    if (!value || typeof value !== 'object') return {}
    return {
      wrap: 'wrap' in value && typeof value.wrap === 'boolean' ? value.wrap : undefined,
      numbers: 'numbers' in value && typeof value.numbers === 'boolean' ? value.numbers : undefined,
    }
  } catch {
    return {}
  }
}
function saveDisplay(change: { wrap?: boolean; numbers?: boolean }) {
  try {
    localStorage.setItem(displayKey, JSON.stringify({ ...readDisplay(), ...change }))
  } catch {}
}
export function plainTextController(props: PlainTextDocumentProps) {
  const display = readDisplay()
  const owner = modelOwner({
    props,
    wrap: display.wrap ?? true,
    numbers: display.numbers ?? props.code,
    language: 'auto' as CodeLanguage | 'auto',
    indent: 'auto',
    initialIndent: detectIndentation(props.content),
    line: 1,
    column: 1,
    selected: 0,
    ending: lineEndingLabel(props.content),
    languageError: '',
    optionsOpen: false,
  })
  return {
    source: owner.source,
    wrap: () => {
      const wrap = !owner.read().wrap
      owner.patch({ wrap })
      saveDisplay({ wrap })
    },
    numbers: (numbers: boolean) => {
      owner.patch({ numbers })
      saveDisplay({ numbers })
    },
    language: (language: string) => {
      if (language === 'auto' || codeLanguages.some(([id]) => id === language))
        owner.patch({ language: language as CodeLanguage | 'auto' })
    },
    indent: (indent: string) => {
      if (['auto', 'tabs', '2', '4', '8'].includes(indent)) owner.patch({ indent })
    },
    options: (optionsOpen: boolean) => owner.patch({ optionsOpen }),
    closeOptions: () => owner.patch({ optionsOpen: false }),
    stats: (line: number, column: number, selected: number) => {
      const state = owner.read()
      if (line !== state.line || column !== state.column || selected !== state.selected)
        owner.patch({ line, column, selected })
    },
    languageError: (languageError: string) => {
      if (owner.read().languageError !== languageError) owner.patch({ languageError })
    },
    receive: (props: PlainTextDocumentProps) =>
      owner.patch({
        props,
        ending:
          props.content === owner.read().props.content
            ? owner.read().ending
            : lineEndingLabel(props.content),
      }),
    lifetime: owner,
  }
}
export function selectedLanguage(language: CodeLanguage | 'auto', props: PlainTextDocumentProps) {
  return language === 'auto' ? detectCodeLanguage(props.path, props.content) : language
}
