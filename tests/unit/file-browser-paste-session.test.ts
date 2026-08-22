import { describe, expect, test } from 'bun:test'
import { createLatestPasteRequestGuard } from '@/features/explorer/use-paste-session'

describe('file browser paste request ordering', () => {
  test('only accepts the newest asynchronous extraction', () => {
    const requests = createLatestPasteRequestGuard()
    const first = requests.begin()
    const second = requests.begin()

    expect(requests.isCurrent(first)).toBe(false)
    expect(requests.isCurrent(second)).toBe(true)
  })

  test('rejects an extraction after the session is cancelled', () => {
    const requests = createLatestPasteRequestGuard()
    const pending = requests.begin()
    requests.cancel()

    expect(requests.isCurrent(pending)).toBe(false)
  })
})
