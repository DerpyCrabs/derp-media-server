import { describe, expect, test } from 'bun:test'
import { DEFAULT_WORKSPACE_SOURCE } from '@/workspace/model/use-workspace'
import { defaultPersistedState } from '@/workspace/shared/workspace-page-persistence'

describe('default browser title', () => {
  test('uses the browser default title', () => {
    expect(defaultPersistedState(DEFAULT_WORKSPACE_SOURCE).windows[0]?.title).toBe('Browser 1')
  })
})
