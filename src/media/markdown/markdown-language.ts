import {
  Language,
  LanguageSupport,
  defineLanguageFacet,
  languageDataProp,
} from '@codemirror/language'
import { markdownParser as baseMarkdownParser, obsidianImageExtension } from '@/lib/markdown-parser'

export { obsidianImageExtension }

const markdownData = defineLanguageFacet({
  commentTokens: { block: { open: '<!--', close: '-->' } },
  closeBrackets: { brackets: ['(', '[', '{', "'", '"', '`'] },
})

export const markdownParser = baseMarkdownParser.configure({
  props: [languageDataProp.add({ Document: markdownData })],
})

export const markdownLanguage = new LanguageSupport(
  new Language(markdownData, markdownParser, [], 'markdown'),
)
