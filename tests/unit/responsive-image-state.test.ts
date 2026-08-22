import { describe, expect, test } from 'bun:test'
import { reduceImageLoadState, type ImageLoadState } from '@/features/viewer/responsive-image'

describe('responsive image load state', () => {
  test('keeps the displayed image while a replacement loads or fails', () => {
    const displayed: ImageLoadState = {
      displayed: { src: '/old', path: 'old.jpg' },
      request: { kind: 'idle' },
    }
    const loading = reduceImageLoadState(displayed, { kind: 'start' })
    const spinning = reduceImageLoadState(loading, { kind: 'show-spinner' })
    const failed = reduceImageLoadState(spinning, { kind: 'error' })

    expect(spinning).toEqual({
      displayed: displayed.displayed,
      request: { kind: 'loading', spinner: true },
    })
    expect(failed).toEqual({ displayed: displayed.displayed, request: { kind: 'error' } })
  })

  test('commits a loaded replacement and resets request state', () => {
    const state: ImageLoadState = {
      displayed: { src: '/old', path: 'old.jpg' },
      request: { kind: 'loading', spinner: true },
    }

    expect(reduceImageLoadState(state, { kind: 'display', src: '/new', path: 'new.jpg' })).toEqual({
      displayed: { src: '/new', path: 'new.jpg' },
      request: { kind: 'idle' },
    })
  })
})
