import { describe, expect, test } from 'bun:test'
import {
  clientPreferencesStore,
  FILE_OPEN_TARGET_STORAGE_KEY,
  syncClientPreferenceStorage,
  WORKSPACE_LAYOUT_STORAGE_KEY,
} from '@/workspace/shared/client-preferences-store'

describe('client preferences store', () => {
  test('applies cross-tab file-open updates to the single live authority', () => {
    let notifications = 0
    const unsubscribe = clientPreferencesStore.source.subscribe(() => {
      notifications += 1
    })

    syncClientPreferenceStorage(
      FILE_OPEN_TARGET_STORAGE_KEY,
      JSON.stringify({ state: { target: 'new-tab' }, version: 0 }),
    )

    expect(clientPreferencesStore.read().fileOpenTarget).toBe('new-tab')
    expect(notifications).toBe(1)
    unsubscribe()
  })

  test('applies and validates cross-tab layout updates atomically', () => {
    syncClientPreferenceStorage(
      WORKSPACE_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        state: { assistGridShape: '2x2', snapAssistOnTopDrag: false, tiledWindowGap: 999 },
        version: 0,
      }),
    )

    expect(clientPreferencesStore.read().assistGridShape).toBe('2x2')
    expect(clientPreferencesStore.read().snapAssistOnTopDrag).toBe(false)
    expect(clientPreferencesStore.read().tiledWindowGap).toBe(24)
  })
})

describe('preference snapshots', () => {
  test('publishes one immutable snapshot for a cross-tab layout change', () => {
    clientPreferencesStore.setAssistGridShape('3x2')
    const before = clientPreferencesStore.source.model()
    const publications: ReturnType<typeof clientPreferencesStore.source.model>[] = []
    const unsubscribe = clientPreferencesStore.source.subscribe((snapshot) => {
      publications.push(snapshot)
    })
    try {
      syncClientPreferenceStorage(
        WORKSPACE_LAYOUT_STORAGE_KEY,
        JSON.stringify({
          state: { assistGridShape: '2x2', snapAssistOnTopDrag: false, tiledWindowGap: 12 },
        }),
      )
      expect(publications).toHaveLength(1)
      expect(publications[0]).toMatchObject({
        assistGridShape: '2x2',
        snapAssistOnTopDrag: false,
        tiledWindowGap: 12,
      })
      expect(Object.isFrozen(publications[0])).toBe(true)
      expect(before.assistGridShape).toBe('3x2')
    } finally {
      unsubscribe()
    }
  })
})
