import { describe, expect, test } from 'bun:test'
import { readerAiPrompt } from '../../src/reader/reader-ai'

describe('reader AI prompts', () => {
  test('keeps compact results to the requested answer', () => {
    expect(readerAiPrompt('define', 'text', '  liminal  ', 'compact')).toContain(
      'only a concise plain-text definition',
    )
    expect(readerAiPrompt('define', 'text', 'liminal', 'compact')).toContain(
      'No labels, examples, or explanation',
    )
    expect(readerAiPrompt('translate', 'text', 'bonjour', 'compact')).toContain(
      'Return translation only',
    )
  })

  test('asks detailed results for explanation and translation grammar', () => {
    const definition = readerAiPrompt('define', 'text', 'liminal', 'detailed')
    expect(definition).toContain('part of speech')
    expect(definition).toContain('nuance')

    const translation = readerAiPrompt('translate', 'text', 'Je suis ici.', 'detailed')
    expect(translation).toContain('translation first')
    expect(translation).toContain('grammar, idioms, tone, and ambiguous choices')
    expect(translation).toContain('--- selected content ---\nJe suis ici.')
  })
})
