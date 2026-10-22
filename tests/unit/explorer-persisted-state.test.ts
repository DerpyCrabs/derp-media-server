import { describe, expect, test } from 'bun:test'
import { readPersistedState } from '@/lib/state/client-store-utils'
import { browserViewModesSchema } from '@/features/explorer/browser-view-mode-store'
import { floatingVideoPositionSchema } from '@/media-center/floating-video-position'

describe('explorer persisted state', () => {
  test('restores compatible preferences and rejects malformed stored values', () => {
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
    const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    let stored = ''
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: () => stored },
    })
    try {
      stored = JSON.stringify({ state: { byKey: { Notes: 'grid' } }, version: 0 })
      expect(readPersistedState('browser-view-mode', browserViewModesSchema)).toEqual({
        byKey: { Notes: 'grid' },
      })
      stored = JSON.stringify({ state: { byKey: { Notes: 'broken' } } })
      expect(readPersistedState('browser-view-mode', browserViewModesSchema)).toBeNull()
      stored = JSON.stringify({ state: { position: { x: 12, y: 24 } } })
      expect(readPersistedState('video-player-position', floatingVideoPositionSchema)).toEqual({
        position: { x: 12, y: 24 },
      })
      stored = JSON.stringify({ state: { position: { x: '12', y: 24 } } })
      expect(readPersistedState('video-player-position', floatingVideoPositionSchema)).toBeNull()
      stored = '{"state":{"position":{"x":1e400,"y":0}}}'
      expect(readPersistedState('video-player-position', floatingVideoPositionSchema)).toBeNull()
      stored = '{invalid'
      expect(readPersistedState('video-player-position', floatingVideoPositionSchema)).toBeNull()
    } finally {
      if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor)
      else Reflect.deleteProperty(globalThis, 'window')
      if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor)
      else Reflect.deleteProperty(globalThis, 'localStorage')
    }
  })
})
