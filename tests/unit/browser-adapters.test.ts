import { Window as HappyWindow } from 'happy-dom'
import { afterAll, afterEach, describe, expect, test } from 'bun:test'

const testWindow = new HappyWindow({ url: 'https://localhost/' })
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: testWindow,
})

const { createPaneExplorerHistory } = await import('@/src/explorer/browser-adapters')

afterEach(() => testWindow.sessionStorage.clear())

afterAll(() => {
  testWindow.close()
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
  else Reflect.deleteProperty(globalThis, 'window')
})

describe('Pane explorer history', () => {
  test('keeps the current entry when a Space presenter remounts with stale Pane state', () => {
    const first = createPaneExplorerHistory('space:pane', '', () => undefined, {
      preserveCurrent: true,
    })
    first.push('Documents')
    first.back()

    const remounted = createPaneExplorerHistory('space:pane', 'Documents', () => undefined, {
      preserveCurrent: true,
    })
    expect(remounted.current()).toBe('')
    remounted.forward()
    expect(remounted.current()).toBe('Documents')
  })

  test('reconciles a standalone Pane to its new initial path', () => {
    const first = createPaneExplorerHistory('pane', '', () => undefined)
    first.push('Documents')
    first.back()

    const remounted = createPaneExplorerHistory('pane', 'Notes', () => undefined)
    expect(remounted.current()).toBe('Notes')
  })

  test('keeps live history in a Pane runtime without rereading device storage', () => {
    const runtime: { history?: { entries: string[]; index: number } } = {}
    const first = createPaneExplorerHistory('space:pane', '', () => undefined, { runtime })
    first.push('Documents')
    testWindow.sessionStorage.clear()

    const remounted = createPaneExplorerHistory('space:pane', '', () => undefined, { runtime })
    expect(remounted.current()).toBe('Documents')
    remounted.back()
    expect(remounted.current()).toBe('')
  })
})
