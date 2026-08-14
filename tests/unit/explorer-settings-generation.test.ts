import { describe, expect, test } from 'bun:test'
import { loadAtStableGeneration } from '@/src/integrations/explorer-adapter'

describe('Explorer settings generation', () => {
  test('does not label an in-flight stale response as current', async () => {
    let generation = 0
    let loadCount = 0
    let releaseFirst!: () => void
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const pending = loadAtStableGeneration(
      () => generation,
      async () => {
        loadCount += 1
        if (loadCount === 1) {
          await firstPending
          return 'stale'
        }
        return 'current'
      },
    )
    generation = 1
    releaseFirst()

    await expect(pending).resolves.toEqual({ value: 'current', generation: 1 })
    expect(loadCount).toBe(2)
  })
})
