import { createSpacePaneRuntime } from '@/src/spaces/pane-runtime'
import { describe, expect, test } from 'bun:test'

describe('Space pane runtime', () => {
  test('keeps pane-local viewer state across presenter remounts', () => {
    const runtime = createSpacePaneRuntime('space-one')
    const firstMount = runtime.viewer('pane-a')
    firstMount.setZoom(175)
    firstMount.setRotation(90)
    firstMount.setImagePath('Pictures/one.jpg')
    firstMount.setReadOnlyView(true)

    const nextMount = runtime.viewer('pane-a')
    expect(nextMount).toBe(firstMount)
    expect(nextMount.zoom()).toBe(175)
    expect(nextMount.rotation()).toBe(90)
    expect(nextMount.imagePath()).toBe('Pictures/one.jpg')
    expect(nextMount.readOnlyView()).toBe(true)

    const browser = runtime.browser('pane-a')
    browser.history = { entries: ['', 'Documents'], index: 1 }
    browser.setCurrentPath?.('Documents')
    expect(runtime.browser('pane-a')).toBe(browser)
    expect(runtime.browser('pane-a').history).toEqual({ entries: ['', 'Documents'], index: 1 })
    expect(runtime.activePath('pane-a')).toBe('Documents')
  })

  test('isolates Pane IDs and forgets closed panes', () => {
    const runtime = createSpacePaneRuntime('space-one')
    const first = runtime.viewer('pane-a')
    first.setZoom(200)
    expect(runtime.viewer('pane-b').zoom()).toBe('fit')
    runtime.forget('pane-a')
    expect(runtime.viewer('pane-a')).not.toBe(first)
    expect(runtime.viewer('pane-a').zoom()).toBe('fit')
  })
})
