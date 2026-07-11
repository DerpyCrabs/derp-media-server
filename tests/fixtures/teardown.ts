import type { FullConfig } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

const batchId = process.env.BATCH_ID
const mediaDirName = batchId ? `test-media-${batchId}` : 'test-media'
const dataDirName = batchId ? `test-data-${batchId}` : 'test-data-local'
const port = batchId ? 9200 + parseInt(batchId) : 5973

const TEST_MEDIA_DIR = path.resolve(mediaDirName)
const DATA_DIR = path.resolve(dataDirName)

function killPort(p: number) {
  try {
    const out = execSync(`netstat -ano | findstr ":${p}" | findstr "LISTEN"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    const pids = new Set(
      out
        .split('\n')
        .map((l) => l.trim().split(/\s+/).pop())
        .filter((pid) => pid && /^\d+$/.test(pid)),
    )
    for (const pid of pids) {
      try {
        process.kill(Number(pid))
      } catch {}
    }
  } catch {}
}

export default async function teardown(_config: FullConfig) {
  console.log(`[e2e${batchId ? `:${batchId}` : ''}] Cleaning up test fixtures...`)

  killPort(port)

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (fs.existsSync(TEST_MEDIA_DIR)) {
        fs.rmSync(TEST_MEDIA_DIR, { recursive: true, force: true })
      }
      break
    } catch {
      // eslint-disable-next-line no-await-in-loop -- retry delay between rm attempts
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1000))
    }
  }

  try {
    if (fs.existsSync(DATA_DIR)) {
      fs.rmSync(DATA_DIR, { recursive: true, force: true })
    }
  } catch {}

  console.log(`[e2e${batchId ? `:${batchId}` : ''}] Test fixtures cleaned up.`)
}
