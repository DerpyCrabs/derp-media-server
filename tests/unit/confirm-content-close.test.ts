import { describe, expect, test } from 'bun:test'
import type { ContentInstance } from '@/lib/domain/content'
import { confirmContentClose } from '@/src/features/content/confirm-content-close'

const instance: ContentInstance = {
  id: 'window-1',
  type: 'integration',
  integration: 'fixture',
  view: 'editor',
  state: {},
}

describe('confirmContentClose', () => {
  test('rejects a close when its captured owner changes during delayed confirmation', async () => {
    let resolveCanClose: ((value: boolean) => void) | undefined
    let current = true
    const confirmation = confirmContentClose(
      {
        canClose: () =>
          new Promise<boolean>((resolve) => {
            resolveCanClose = resolve
          }),
      },
      [instance],
      () => current,
    )

    await Promise.resolve()
    current = false
    resolveCanClose?.(true)

    expect(await confirmation).toBe(false)
  })

  test('accepts only when every owner remains current and every instance can close', async () => {
    const checked: string[] = []
    const second = { ...instance, id: 'window-2' }
    expect(
      await confirmContentClose(
        {
          canClose: (content) => {
            checked.push(content.id)
            return Promise.resolve(true)
          },
        },
        [instance, second],
        () => true,
      ),
    ).toBe(true)
    expect(checked).toEqual(['window-1', 'window-2'])
  })

  test('Workspace and Canvas guard every async content removal and replacement', async () => {
    const [workspace, canvas] = await Promise.all([
      Bun.file('src/WorkspacePage.tsx').text(),
      Bun.file('src/CanvasPage.tsx').text(),
    ])

    expect(workspace.match(/confirmContentClose\(/g)).toHaveLength(4)
    expect(workspace).toMatch(/v0 !== initial/)
    expect(workspace).toMatch(/currentTarget !== target/)
    expect(canvas.match(/confirmContentClose\(/g)).toHaveLength(4)
    expect(canvas).toMatch(/definition !== target/)
    expect(canvas).toMatch(/targetIsCurrent/)
  })
})
