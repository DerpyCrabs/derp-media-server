import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

const BATCHES = [
  {
    id: '1',
    tests: ['audio-player', 'video-player', 'pdf-viewer', 'image-viewer', 'download'],
  },
  {
    id: '2',
    tests: ['navigation', 'login', 'share-viewers'],
  },
  {
    id: '3',
    tests: [
      'editable-folders',
      'drag-drop',
      'upload',
      'text-editor',
      'knowledge-base',
      'passcode-shares',
    ],
  },
  {
    id: '4',
    tests: [
      'shares-manage',
      'shares-use',
      'share-audio-api',
      'sse-live-updates',
      'url-state',
      'share-security',
    ],
  },
  {
    id: '5',
    tests: ['workspace-layout'],
  },
  {
    id: '6',
    tests: ['workspace-controls'],
  },
  {
    id: '7',
    tests: ['workspace-viewers'],
  },
  {
    id: '8',
    tests: ['share-workspace'],
  },
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

function runBatch(batch: (typeof BATCHES)[number]): Promise<number> {
  const port = 9200 + parseInt(batch.id)
  generateBatchConfig(batch.id, port)

  const hasLoginTests = batch.tests.includes('login')
  const projects = hasLoginTests
    ? ['--project=auth-setup', '--project=login', '--project=chromium']
    : ['--project=auth-setup', '--project=chromium']

  const testFiles = batch.tests.map((t) => `tests/e2e/${t}.spec.ts`)

  const args = ['playwright', 'test', ...testFiles, ...projects]

  const prefix = `[batch:${batch.id}]`

  return new Promise((resolve) => {
    const child = spawn('bunx', args, {
      cwd: ROOT,
      env: {
        ...process.env,
        BATCH_ID: batch.id,
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
      resolve(code ?? 1)
    })
  })
}

async function main() {
  console.log(`Starting ${BATCHES.length} test batches in parallel...\n`)
  const startTime = Date.now()

  try {
    const results = await Promise.all(BATCHES.map(runBatch))

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`\n${'─'.repeat(60)}`)
    console.log(`Batch results (${elapsed}s total):`)

    let allPassed = true
    for (let i = 0; i < BATCHES.length; i++) {
      const status = results[i] === 0 ? 'PASS' : 'FAIL'
      if (results[i] !== 0) allPassed = false
      const testList = BATCHES[i].tests.join(', ')
      console.log(`  Batch ${BATCHES[i].id}: ${status}  (${testList})`)
    }

    console.log(`${'─'.repeat(60)}`)
    console.log(allPassed ? '\nAll batches passed!' : '\nSome batches failed!')
    process.exit(allPassed ? 0 : 1)
  } finally {
    for (const batch of BATCHES) {
      cleanupBatchConfig(batch.id)
    }
  }
}

main()
