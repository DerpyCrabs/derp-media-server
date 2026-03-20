import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

/**
 * Same six batch IDs / parallelism as React (`run-batches.ts`), only specs that exist under
 * `tests/e2e-solid/`.
 */
const BATCHES = [
  { id: '1', tests: ['smoke'] },
  { id: '2', tests: ['navigation', 'upload'] },
  {
    id: '3',
    tests: [
      'download',
      'workspace-layout-sessions',
      'workspace-layout-snap-resize',
      'workspace-taskbar-pins',
      'workspace-viewers',
    ],
  },
  { id: '4', tests: ['url-state', 'login'] },
  { id: '5', tests: ['audio-player', 'video-player'] },
  { id: '6', tests: ['image-viewer', 'text-editor'] },
]

const ROOT = path.resolve(__dirname, '..')
const FIXTURES_DIR = path.join(__dirname, 'fixtures')

function generateBatchConfig(batchId: string, port: number): string {
  const configPath = path.join(FIXTURES_DIR, `test-config-${batchId}.jsonc`)
  const config = {
    mediaDir: `test-media-${batchId}`,
    dataPath: `../../test-data-${batchId}`,
    editableFolders: ['Notes', 'SharedContent'],
    shareLinkDomain: `http://localhost:${port}`,
    auth: { enabled: true, password: 'test-password' },
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
  return configPath
}

function cleanupBatchConfig(batchId: string) {
  const configPath = path.join(FIXTURES_DIR, `test-config-${batchId}.jsonc`)
  try {
    fs.unlinkSync(configPath)
  } catch {}
}

type JsonReport = {
  suites?: Array<{
    file?: string
    specs?: Array<{
      file?: string
      tests?: Array<{ results?: Array<{ duration?: number }> }>
    }>
    suites?: JsonReport['suites']
  }>
}

function extractFileTimesFromJsonReport(jsonPath: string): Record<string, number> {
  const out: Record<string, number> = {}
  let data: JsonReport
  try {
    data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
  } catch {
    return out
  }

  function visit(suites: JsonReport['suites']) {
    if (!suites) return
    for (const suite of suites) {
      if (suite.specs) {
        for (const spec of suite.specs) {
          const file = spec.file ?? suite.file
          if (!file) continue
          const base = path.basename(file)
          const name = base.replace(/\.(spec\.)?ts$/, '')
          let total = 0
          for (const t of spec.tests ?? []) {
            for (const r of t.results ?? []) {
              if (typeof r.duration === 'number') total += r.duration
            }
          }
          if (total > 0) out[name] = (out[name] ?? 0) + total
        }
      }
      visit(suite.suites)
    }
  }
  visit(data.suites)
  return out
}

function runBatch(batch: (typeof BATCHES)[number]): Promise<{
  code: number
  elapsedMs: number
  fileTimes: Record<string, number>
}> {
  const port = 9200 + parseInt(batch.id)
  generateBatchConfig(batch.id, port)

  const hasLoginTests = batch.tests.includes('login')
  const projects = hasLoginTests
    ? ['--project=auth-setup', '--project=login', '--project=chromium']
    : ['--project=auth-setup', '--project=chromium']

  const testFiles = batch.tests.map((t) => `tests/e2e-solid/${t}.spec.ts`)

  const jsonOutputPath = path.join(FIXTURES_DIR, `batch-solid-${batch.id}-results.json`)
  const args = [
    'playwright',
    'test',
    '-c',
    'playwright.solid.config.ts',
    ...testFiles,
    ...projects,
    '--reporter=line',
    '--reporter=json',
  ]

  const prefix = `[batch:solid:${batch.id}]`
  const startMs = Date.now()

  return new Promise((resolve) => {
    const child = spawn('bunx', args, {
      cwd: ROOT,
      env: {
        ...process.env,
        BATCH_ID: batch.id,
        PLAYWRIGHT_JSON_OUTPUT_NAME: jsonOutputPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    })

    child.stdout.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n')) {
        if (line.trim()) process.stdout.write(`${prefix} ${line}\n`)
      }
    })

    child.stderr.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n')) {
        if (line.trim()) process.stderr.write(`${prefix} ${line}\n`)
      }
    })

    child.on('close', (code) => {
      const elapsedMs = Date.now() - startMs
      const fileTimes = extractFileTimesFromJsonReport(jsonOutputPath)
      try {
        fs.unlinkSync(jsonOutputPath)
      } catch {}
      resolve({ code: code ?? 1, elapsedMs, fileTimes })
    })
  })
}

async function main() {
  console.log(`Starting ${BATCHES.length} Solid test batches in parallel...\n`)
  const startTime = Date.now()

  try {
    const results = await Promise.all(BATCHES.map(runBatch))

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`\n${'─'.repeat(60)}`)
    console.log(`Solid batch results (${elapsed}s total):`)

    let allPassed = true
    for (let i = 0; i < BATCHES.length; i++) {
      const { code, elapsedMs, fileTimes } = results[i]
      const status = code === 0 ? 'PASS' : 'FAIL'
      if (code !== 0) allPassed = false
      const names =
        fileTimes['auth-setup'] != null ? ['auth-setup', ...BATCHES[i].tests] : BATCHES[i].tests
      const testListWithTimes = names
        .map((t) => {
          const sec = fileTimes[t] != null ? (fileTimes[t] / 1000).toFixed(1) : '?'
          return `${t} ${sec}s`
        })
        .join(', ')
      const elapsedSec = (elapsedMs / 1000).toFixed(1)
      console.log(
        `  Batch ${BATCHES[i].id} (solid): ${status}  ${elapsedSec}s  (${testListWithTimes})`,
      )
    }

    console.log(`${'─'.repeat(60)}`)
    console.log(allPassed ? '\nAll Solid batches passed!' : '\nSome Solid batches failed!')
    process.exit(allPassed ? 0 : 1)
  } finally {
    for (const batch of BATCHES) {
      cleanupBatchConfig(batch.id)
    }
  }
}

void main()
