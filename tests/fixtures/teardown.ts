import type { FullConfig } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

const TEST_MEDIA_DIR = path.resolve('test-media')
const MEDIA_DIR_KEY = 'test-media'

function cleanJsonFile(filePath: string) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    delete data[MEDIA_DIR_KEY]
    if (Object.keys(data).length === 0) {
      fs.unlinkSync(filePath)
    } else {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
    }
  } catch {
    // file doesn't exist, nothing to clean
  }
}

function killPort(port: number) {
  try {
    const out = execSync(`netstat -ano | findstr ":${port}" | findstr "LISTEN"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    const pids = new Set(
      out
        .split('\n')
        .map((l) => l.trim().split(/\s+/).pop())
        .filter((p) => p && /^\d+$/.test(p)),
    )
    for (const pid of pids) {
      try {
        process.kill(Number(pid))
      } catch {}
    }
  } catch {}
}

export default async function teardown(_config: FullConfig) {
  console.log('[e2e] Cleaning up test fixtures...')

  killPort(5973)

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (fs.existsSync(TEST_MEDIA_DIR)) {
        fs.rmSync(TEST_MEDIA_DIR, { recursive: true, force: true })
      }
      break
    } catch {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1000))
    }
  }

  cleanJsonFile(path.resolve('settings.json'))
  cleanJsonFile(path.resolve('shares.json'))
  cleanJsonFile(path.resolve('stats.json'))

  console.log('[e2e] Test fixtures cleaned up.')
}
