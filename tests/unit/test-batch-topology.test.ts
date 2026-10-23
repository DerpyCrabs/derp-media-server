import { describe, expect, test } from 'bun:test'
import playwrightConfig from '../../playwright.config'
import { readdirSync } from 'node:fs'
import { BATCHES, runBatches } from '../run-batches'

describe('CI test topology', () => {
  test('uses six parallel single-worker batches', () => {
    expect(BATCHES).toHaveLength(6)
    expect(playwrightConfig.workers).toBe(1)
  })

  test('includes every e2e spec exactly once across the batches', () => {
    const specs = readdirSync(new URL('../e2e', import.meta.url))
      .filter((file) => file.endsWith('.spec.ts'))
      .map((file) => file.slice(0, -'.spec.ts'.length))
      .sort()
    const assigned = BATCHES.flatMap((batch) => batch.tests).sort()
    expect(assigned).toEqual(specs)
    expect(new Set(assigned).size).toBe(assigned.length)
  })

  test('retains failure traces even when retries are disabled', () => {
    expect(playwrightConfig.use?.trace).toBe('retain-on-failure')
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
