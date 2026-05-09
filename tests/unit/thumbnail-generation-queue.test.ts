import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { isThumbnailAbortError, ThumbnailGenerationQueue } from '@/server/lib/thumbnails'

const tempDirs: string[] = []

function waitForQueueTurn() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function createTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'thumbnail-queue-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('ThumbnailGenerationQueue', () => {
  test('runs cache misses sequentially', async () => {
    const dir = await createTempDir()
    const order: string[] = []
    let releaseFirst!: () => void

    const queue = new ThumbnailGenerationQueue(async (filePath, outputPath) => {
      const name = path.basename(filePath)
      order.push(`start:${name}`)
      if (name === 'a.jpg') {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
      }
      await fs.writeFile(outputPath, name)
      order.push(`end:${name}`)
    })

    const first = queue.getOrGenerate('a.jpg', path.join(dir, 'a-cache.jpg'))
    const second = queue.getOrGenerate('b.jpg', path.join(dir, 'b-cache.jpg'))

    await waitForQueueTurn()
    expect(order).toEqual(['start:a.jpg'])

    releaseFirst()
    await Promise.all([first, second])

    expect(order).toEqual(['start:a.jpg', 'end:a.jpg', 'start:b.jpg', 'end:b.jpg'])
  })

  test('deduplicates duplicate cache misses', async () => {
    const dir = await createTempDir()
    const cachePath = path.join(dir, 'shared-cache.jpg')
    let calls = 0
    let release!: () => void

    const queue = new ThumbnailGenerationQueue(async (_filePath, outputPath) => {
      calls += 1
      await new Promise<void>((resolve) => {
        release = resolve
      })
      await fs.writeFile(outputPath, 'thumbnail')
    })

    const first = queue.getOrGenerate('same.jpg', cachePath)
    const second = queue.getOrGenerate('same.jpg', cachePath)

    await waitForQueueTurn()
    expect(calls).toBe(1)

    release()
    await Promise.all([first, second])
    await expect(fs.readFile(cachePath, 'utf8')).resolves.toBe('thumbnail')
  })

  test('bypasses the queue for cache hits', async () => {
    const dir = await createTempDir()
    const cachePath = path.join(dir, 'cached.jpg')
    await fs.writeFile(cachePath, 'cached')
    let calls = 0

    const queue = new ThumbnailGenerationQueue(async () => {
      calls += 1
    })

    await queue.getOrGenerate('already-generated.jpg', cachePath)

    expect(calls).toBe(0)
  })

  test('removes queued waiters when their request aborts', async () => {
    const dir = await createTempDir()
    const order: string[] = []
    let releaseFirst!: () => void
    const controller = new AbortController()

    const queue = new ThumbnailGenerationQueue(async (filePath, outputPath) => {
      const name = path.basename(filePath)
      order.push(name)
      if (name === 'a.jpg') {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
      }
      await fs.writeFile(outputPath, name)
    })

    const first = queue.getOrGenerate('a.jpg', path.join(dir, 'a-cache.jpg'))
    const second = queue.getOrGenerate('b.jpg', path.join(dir, 'b-cache.jpg'), controller.signal)
    const secondError = second.catch((error) => error)

    await waitForQueueTurn()
    controller.abort()

    expect(isThumbnailAbortError(await secondError)).toBe(true)

    releaseFirst()
    await first
    await waitForQueueTurn()

    expect(order).toEqual(['a.jpg'])
  })
})
