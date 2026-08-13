import { describe, expect, test } from 'bun:test'
import playwrightConfig from '../../playwright.config'
import { BATCHES, runBatches } from '../run-batches'

describe('CI test topology', () => {
  test('uses six parallel single-worker batches', () => {
    expect(BATCHES).toHaveLength(6)
    expect(playwrightConfig.workers).toBe(1)
  })

  test('starts every batch without a concurrency limiter', async () => {
    const started: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const running = runBatches(async (batch) => {
      started.push(batch.id)
      await gate
      return batch.id
    })

    expect(started).toEqual(BATCHES.map((batch) => batch.id))
    release()
    expect(await running).toEqual(BATCHES.map((batch) => batch.id))
  })
})
