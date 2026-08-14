import { Window as HappyWindow } from 'happy-dom'
import { afterAll, describe, expect, test } from 'bun:test'

const testWindow = new HappyWindow({ url: 'http://localhost/' })
const installedGlobals = ['window', 'document', 'MutationObserver', 'HTMLElement', 'Event'] as const
const previousGlobals = new Map<string, PropertyDescriptor | undefined>()

for (const name of installedGlobals) {
  previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value: name === 'window' ? testWindow : testWindow[name],
  })
}

const { bindReadingProgress, canvasReadingProgressKey } =
  await import('@/src/canvas/reading-progress')

afterAll(() => {
  testWindow.close()
  for (const [name, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
})

describe('canvas reading progress', () => {
  test('owns the device-local presentation key', () => {
    expect(canvasReadingProgressKey('canvas-1', 'Books/example.epub')).toBe(
      'canvas-reading-position-v1:canvas-1:Books/example.epub',
    )
  })

  test('restores after a scroll container mounts asynchronously and cleans up', async () => {
    const root = document.createElement('div')
    const values = new Map([['reading-key', '0.5']])
    const cleanup = bindReadingProgress({
      element: root,
      key: () => 'reading-key',
      storage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
      },
      retryDelays: [],
    })

    const scroller = document.createElement('div')
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1_000 },
    })
    root.append(scroller)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(scroller.scrollTop).toBe(400)

    scroller.scrollTop = 600
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
    expect(values.get('reading-key')).toBe('0.75')

    cleanup()
    const replacement = document.createElement('div')
    Object.defineProperties(replacement, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1_000 },
    })
    scroller.replaceWith(replacement)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(replacement.scrollTop).toBe(0)
  })
})
