import { describe, expect, test } from 'bun:test'
import { defaultInitialBrowserTitle } from '@/workspace/page/workspace-page-persistence'

describe('defaultInitialBrowserTitle', () => {
  test('uses the browser default title', () => {
    expect(defaultInitialBrowserTitle()).toBe('Browser 1')
  })
})
