import type { FullConfig } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { generateTestMedia, patchTestMediaAfterCacheCopy } from './generate-media'

const batchId = process.env.BATCH_ID
const mediaDirName = batchId ? `test-media-${batchId}` : 'test-media'
const dataDirName = batchId ? `test-data-${batchId}` : 'test-data-local'

const TEST_MEDIA_DIR = path.resolve(mediaDirName)
const MEDIA_CACHE_DIR = path.resolve(__dirname, '..', '..', '.test-media-cache')
const DATA_DIR = path.resolve(dataDirName)

export default async function setup(_config: FullConfig) {
  console.log(`[e2e${batchId ? `:${batchId}` : ''}] Setting up test fixtures...`)

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (fs.existsSync(TEST_MEDIA_DIR)) {
        fs.rmSync(TEST_MEDIA_DIR, { recursive: true, force: true })
      }
      break
    } catch {
      // eslint-disable-next-line no-await-in-loop -- retry delay between rm attempts
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1000))
      else throw new Error(`Failed to clean ${mediaDirName} directory after 3 attempts`)
    }
  }

  if (fs.existsSync(MEDIA_CACHE_DIR)) {
    fs.cpSync(MEDIA_CACHE_DIR, TEST_MEDIA_DIR, { recursive: true })
  } else {
    generateTestMedia(TEST_MEDIA_DIR)
  }
  patchTestMediaAfterCacheCopy(TEST_MEDIA_DIR)

  fs.mkdirSync(DATA_DIR, { recursive: true })

  console.log(`[e2e${batchId ? `:${batchId}` : ''}] Test fixtures ready.`)
}
