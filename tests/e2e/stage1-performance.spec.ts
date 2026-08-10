import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import budgets from '../../stage1-performance-budgets.json'

const batchId = process.env.BATCH_ID
const mediaDirName = batchId ? `test-media-${batchId}` : 'test-media'
const folderName = `Stage1BrowseFixture-${batchId ?? 'local'}`
const fixtureEntries = budgets.baseline.browseFixtureEntries
const samples = budgets.baseline.browseSamples
const browseP95Limit = budgets.baseline.browseP95Ms + budgets.permittedStage1Delta.browseP95Ms

test.describe('Stage 1 browse performance baseline', () => {
  test.beforeAll(() => {
    const folderPath = path.resolve(mediaDirName, folderName)
    fs.rmSync(folderPath, { recursive: true, force: true })
    fs.mkdirSync(folderPath, { recursive: true })
    for (let index = 0; index < fixtureEntries; index += 1) {
      fs.writeFileSync(
        path.join(folderPath, `item-${String(index).padStart(4, '0')}.txt`),
        String(index),
      )
    }
  })

  test.afterAll(() => {
    fs.rmSync(path.resolve(mediaDirName, folderName), { recursive: true, force: true })
  })

  test('keeps fixed-fixture first listing inside checked p95 budget', async ({ page }) => {
    await page.goto('/')
    const result = await page.evaluate(
      async ({ directory, count, sampleCount }) => {
        const measure = async (sample: number) => {
          const started = performance.now()
          const response = await fetch(
            `/api/files?dir=${encodeURIComponent(directory)}&stage1Sample=${sample}`,
            { cache: 'no-store' },
          )
          const body = (await response.json()) as { files?: unknown[] }
          if (!response.ok || body.files?.length !== count) {
            throw new Error(`Unexpected browse response: ${response.status}/${body.files?.length}`)
          }
          return performance.now() - started
        }

        await measure(-1)
        const durations: number[] = []
        for (let sample = 0; sample < sampleCount; sample += 1) {
          durations.push(await measure(sample))
        }
        durations.sort((left, right) => left - right)
        const p95 = durations[Math.ceil(durations.length * 0.95) - 1]
        return { p95, minimum: durations[0], maximum: durations.at(-1) }
      },
      { directory: folderName, count: fixtureEntries, sampleCount: samples },
    )

    console.log(
      `STAGE1_BROWSE_P95_MS=${result.p95.toFixed(2)} min=${result.minimum.toFixed(2)} max=${result.maximum?.toFixed(2)}`,
    )
    expect(result.p95).toBeLessThanOrEqual(browseP95Limit)
  })
})
