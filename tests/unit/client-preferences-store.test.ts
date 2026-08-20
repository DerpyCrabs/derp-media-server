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
    const unsubscribe = clientPreferencesStore.subscribe(() => {
      notifications += 1
    })

    syncClientPreferenceStorage(
      FILE_OPEN_TARGET_STORAGE_KEY,
      JSON.stringify({ state: { target: 'new-tab' }, version: 0 }),
    )

    expect(clientPreferencesStore.getState().fileOpenTarget).toBe('new-tab')
    expect(notifications).toBe(1)
    unsubscribe()
  })

  test('applies and validates cross-tab layout updates atomically', () => {
    syncClientPreferenceStorage(
      WORKSPACE_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        state: {
          assistGridShape: '2x2',
          snapAssistOnTopDrag: false,
          tiledWindowGap: 999,
        },
        version: 0,
      }),
    )

    expect(clientPreferencesStore.getState().assistGridShape).toBe('2x2')
    expect(clientPreferencesStore.getState().snapAssistOnTopDrag).toBe(false)
    expect(clientPreferencesStore.getState().tiledWindowGap).toBe(24)
  })
})
