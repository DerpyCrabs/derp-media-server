import { afterEach, describe, expect, test } from 'bun:test'
import { thumbnailBinding } from '@/features/explorer/thumbnail-binding'

const originalObserver = globalThis.IntersectionObserver
const callbacks: IntersectionObserverCallback[] = []
const resources: ReturnType<typeof thumbnailBinding>[] = []

function mountThumbnail(initial = { url: 'thumbnail.jpg' }) {
  let state = initial
  globalThis.IntersectionObserver = class {
    constructor(callback: IntersectionObserverCallback) {
      callbacks.push(callback)
    }
    observe() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver
  const target = document.createElement('div')
  const loaded: string[] = []
  const resource = thumbnailBinding(target, () => ({
    ...state,
    patch: (state) => {
      if (state.queuedSrc) loaded.push(state.queuedSrc)
    },
  }))
  resources.push(resource)
  const callback = callbacks.at(-1)!
  const visibility = (visible: boolean) =>
    callback([{ isIntersecting: visible } as IntersectionObserverEntry], {} as IntersectionObserver)
  return {
    target,
    loaded,
    resource,
    visibility,
    change: (next: typeof initial) => {
      state = next
      resource.update()
    },
  }
}

afterEach(() => {
  for (const resource of resources.splice(0)) resource.dispose()
  callbacks.length = 0
  globalThis.IntersectionObserver = originalObserver
})

describe('thumbnail binding lifetime', () => {
  test('coalesces repeated visible notifications and releases its queue permit', async () => {
    const first = mountThumbnail()
    first.visibility(true)
    first.visibility(true)
    await new Promise((resolve) => setTimeout(resolve, 160))
    expect(first.loaded).toEqual(['thumbnail.jpg'])
    first.target.dispatchEvent(new Event('load'))
    first.visibility(true)
    await new Promise((resolve) => setTimeout(resolve, 160))
    expect(first.loaded).toEqual(['thumbnail.jpg'])
    first.resource.dispose()

    const next = Array.from({ length: 4 }, () => mountThumbnail())
    for (const item of next) item.visibility(true)
    await new Promise((resolve) => setTimeout(resolve, 160))
    expect(next.map((item) => item.loaded.length)).toEqual([1, 1, 1, 1])
  })

  test('cancels a scheduled load when disposed', async () => {
    const item = mountThumbnail()
    item.visibility(true)
    item.resource.dispose()
    await new Promise((resolve) => setTimeout(resolve, 160))
    expect(item.loaded).toEqual([])
  })

  test('can schedule again after leaving and reentering the viewport', async () => {
    const item = mountThumbnail()
    item.visibility(true)
    item.visibility(false)
    item.visibility(true)
    await new Promise((resolve) => setTimeout(resolve, 160))
    expect(item.loaded).toEqual(['thumbnail.jpg'])
  })
})

describe('thumbnail queue permits', () => {
  test('cancels waiters and releases active permits on errors and disposal', async () => {
    const items = Array.from({ length: 7 }, () => mountThumbnail())
    for (const item of items) item.visibility(true)
    await new Promise((resolve) => setTimeout(resolve, 160))
    expect(items.map((item) => item.loaded.length)).toEqual([1, 1, 1, 1, 0, 0, 0])

    items[4]!.resource.dispose()
    items[0]!.target.dispatchEvent(new Event('error'))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(items.map((item) => item.loaded.length)).toEqual([1, 1, 1, 1, 0, 1, 0])

    items[1]!.resource.dispose()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(items.map((item) => item.loaded.length)).toEqual([1, 1, 1, 1, 0, 1, 1])
  })

  test('replaces a waiting URL without loading stale thumbnails', async () => {
    const active = Array.from({ length: 4 }, () => mountThumbnail())
    for (const item of active) item.visibility(true)
    await new Promise((resolve) => setTimeout(resolve, 160))
    const waiting = mountThumbnail()
    waiting.visibility(true)
    await new Promise((resolve) => setTimeout(resolve, 160))
    waiting.change({ url: 'replacement.jpg' })
    active[0]!.target.dispatchEvent(new Event('load'))
    await new Promise((resolve) => setTimeout(resolve, 160))
    expect(waiting.loaded).toEqual(['replacement.jpg'])
  })

  test('offscreen thumbnails wait for visibility and share the concurrency limit', async () => {
    const hidden = mountThumbnail({ url: 'cached-thumbnail.jpg' })
    expect(hidden.loaded).toEqual([])
    const active = Array.from({ length: 4 }, () => mountThumbnail())
    for (const item of active) item.visibility(true)
    await new Promise((resolve) => setTimeout(resolve, 160))
    expect(active.map((item) => item.loaded.length)).toEqual([1, 1, 1, 1])
    expect(hidden.loaded).toEqual([])
    hidden.visibility(true)
    await new Promise((resolve) => setTimeout(resolve, 160))
    expect(hidden.loaded).toEqual([])
    active[0]!.target.dispatchEvent(new Event('load'))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(hidden.loaded).toEqual(['cached-thumbnail.jpg'])
  })
})
