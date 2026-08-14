import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import playwrightConfig from '../../playwright.config'
import { BATCHES, runBatches } from '../run-batches'

const E2E_DIR = path.resolve(import.meta.dir, '../e2e')

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

  test('batch manifest covers every E2E spec exactly once', () => {
    const existing = fs
      .readdirSync(E2E_DIR)
      .filter((file) => file.endsWith('.spec.ts'))
      .map((file) => file.replace(/\.spec\.ts$/, ''))
      .sort()
    const listed = BATCHES.flatMap((batch) => batch.tests)
    const counts = new Map<string, number>()

    for (const name of listed) counts.set(name, (counts.get(name) ?? 0) + 1)

    expect([...new Set(listed)].sort()).toEqual(existing)
    expect([...counts.entries()].filter(([, count]) => count !== 1)).toEqual([])
  })
})
