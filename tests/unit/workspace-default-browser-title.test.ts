import { describe, expect, test } from 'bun:test'
import { defaultInitialBrowserTitle } from '@/src/workspace/workspace-page-persistence'

describe('defaultInitialBrowserTitle', () => {
  test('share uses basename of shared path', () => {
    expect(
      defaultInitialBrowserTitle({
        kind: 'share',
        token: 't',
        sharePath: 'D:\\media\\Work',
      }),
    ).toBe('Work')
    expect(
      defaultInitialBrowserTitle({
        kind: 'share',
        token: 't',
        sharePath: '/var/media/Work',
      }),
    ).toBe('Work')
  })

  test('local stays Browser 1', () => {
    expect(defaultInitialBrowserTitle({ kind: 'local', rootPath: null })).toBe('Browser 1')
  })
})
