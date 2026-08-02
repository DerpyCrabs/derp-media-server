import { describe, expect, test } from 'bun:test'

import { completeMarkdownImagePaste } from '@/src/media/markdown/paste-completion'

describe('completeMarkdownImagePaste', () => {
  test('offers an accepted insertion for save after reactive state can flush', async () => {
    let readMode = false
    let saved = 0
    let completed: string | null | undefined

    const accepted = completeMarkdownImagePaste(
      '![[image.png]]',
      (markdown) => {
        completed = markdown
        return true
      },
      () => readMode,
      () => {
        saved += 1
      },
    )

    expect(accepted).toBe(true)
    expect(completed).toBe('![[image.png]]')
    expect(saved).toBe(0)
    readMode = true
    await Promise.resolve()
    expect(saved).toBe(1)
  })

  test('does not save rejected or cancelled completions', async () => {
    let saved = 0
    const save = () => {
      saved += 1
    }

    expect(
      completeMarkdownImagePaste(
        '![[unused.png]]',
        () => false,
        () => true,
        save,
      ),
    ).toBe(false)
    expect(
      completeMarkdownImagePaste(
        null,
        () => true,
        () => true,
        save,
      ),
    ).toBe(true)

    await Promise.resolve()
    expect(saved).toBe(0)
  })
})
