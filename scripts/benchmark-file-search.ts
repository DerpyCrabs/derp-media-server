import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import type { FileSearchResponse, FileSearchStatus } from '@/lib/file-search'

if (process.env.FILE_SEARCH_BENCHMARK !== '1') {
  throw new Error('Set FILE_SEARCH_BENCHMARK=1 to run this disk-intensive benchmark')
}

const entryCount = Math.max(1, Number(process.env.FILE_SEARCH_BENCHMARK_ENTRIES ?? 1_000_000))
const filesPerDirectory = 1_000
const providedRoot = process.env.FILE_SEARCH_BENCHMARK_DIR
const benchmarkRoot = providedRoot
  ? path.resolve(providedRoot)
  : fs.mkdtempSync(path.join(os.tmpdir(), 'derp-file-search-benchmark-'))
const mediaRoot = path.join(benchmarkRoot, 'media')
const dataPath = path.join(benchmarkRoot, 'data')
const indexPath = path.join(benchmarkRoot, 'index', 'files.sqlite')
const configPath = path.join(benchmarkRoot, 'config.json')
const keepFiles = process.env.FILE_SEARCH_BENCHMARK_KEEP === '1' || !!providedRoot

function percentile(values: number[], fraction: number) {
  if (values.length === 0) return 0
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
}

function round(value: number) {
  return Math.round(value * 100) / 100
}

async function generateFiles() {
  fs.mkdirSync(mediaRoot, { recursive: true })
  let created = 0
  for (let directoryIndex = 0; created < entryCount; directoryIndex++) {
    const directory = path.join(mediaRoot, `directory-${String(directoryIndex).padStart(6, '0')}`)
    fs.mkdirSync(directory)
    const batch: Promise<void>[] = []
    for (let fileIndex = 0; fileIndex < filesPerDirectory && created < entryCount; fileIndex++) {
      const name = `file-${String(created).padStart(9, '0')}.txt`
      batch.push(fs.promises.writeFile(path.join(directory, name), ''))
      created++
    }
    await Promise.all(batch)
  }
}

async function databaseSize() {
  let bytes = 0
  for (const file of [indexPath, `${indexPath}-wal`, `${indexPath}-shm`]) {
    try {
      bytes += (await fs.promises.stat(file)).size
    } catch {}
  }
  return bytes
}

async function reservePort() {
  const reservation = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = reservation.port
  reservation.stop(true)
  return port
}

async function waitForServer(baseUrl: string) {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/files/search/status`)
      if (response.ok) return
    } catch {}
    await Bun.sleep(50)
  }
  throw new Error('Rust benchmark server did not start')
}

let server: Bun.Subprocess | undefined
try {
  const generationStarted = performance.now()
  await generateFiles()
  const generationMs = performance.now() - generationStarted

  const build = Bun.spawn(['cargo', 'build', '--release'], { stdout: 'inherit', stderr: 'inherit' })
  if ((await build.exited) !== 0) throw new Error('Rust release build failed')

  const port = await reservePort()
  fs.mkdirSync(dataPath, { recursive: true })
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      port,
      mediaDir: mediaRoot,
      dataPath,
      fileSearch: {
        enabled: true,
        indexPath,
        watchMode: 'off',
        maxRecursiveWatchers: 0,
        maxFsConcurrency: 4,
        reconcileDirectoriesPerSecond: 128,
      },
    }),
  )
  const binary = path.resolve(
    process.platform === 'win32'
      ? 'target/release/derp-media-server.exe'
      : 'target/release/derp-media-server',
  )
  server = Bun.spawn([binary, '--production', `--config-path=${configPath}`], {
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
  })
  const baseUrl = `http://127.0.0.1:${port}`
  const buildStarted = performance.now()
  await waitForServer(baseUrl)

  const httpLatencies: number[] = []
  let status: FileSearchStatus
  do {
    const started = performance.now()
    const response = await fetch(`${baseUrl}/api/files/search/status`)
    httpLatencies.push(performance.now() - started)
    status = (await response.json()) as FileSearchStatus
    if (status.state === 'building' || status.state === 'starting') await Bun.sleep(25)
  } while (status.state === 'building' || status.state === 'starting')
  const buildMs = performance.now() - buildStarted

  const queryLatencies: number[] = []
  const queries = ['file-000', '000123', 'txt', 'directory-000']
  for (let index = 0; index < 100; index++) {
    const started = performance.now()
    const response = await fetch(
      `${baseUrl}/api/files/search?q=${encodeURIComponent(queries[index % queries.length])}&limit=50`,
    )
    if (!response.ok) throw new Error(`Search failed with HTTP ${response.status}`)
    ;(await response.json()) as FileSearchResponse
    queryLatencies.push(performance.now() - started)
  }

  const sizeBytes = await databaseSize()
  console.log(
    JSON.stringify(
      {
        entries: status.indexedEntries,
        generatedFiles: entryCount,
        generationSeconds: round(generationMs / 1_000),
        buildSeconds: round(buildMs / 1_000),
        indexedEntriesPerSecond: round(status.indexedEntries / (buildMs / 1_000)),
        databaseMB: round(sizeBytes / 1024 / 1024),
        queryP50Ms: round(percentile(queryLatencies, 0.5)),
        queryP95Ms: round(percentile(queryLatencies, 0.95)),
        httpP50MsDuringBuild: round(percentile(httpLatencies, 0.5)),
        httpP95MsDuringBuild: round(percentile(httpLatencies, 0.95)),
        root: benchmarkRoot,
      },
      null,
      2,
    ),
  )
} finally {
  server?.kill()
  if (server) await server.exited
  if (!keepFiles) {
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        fs.rmSync(benchmarkRoot, { recursive: true, force: true })
        break
      } catch (error) {
        if (attempt === 19) throw error
        await Bun.sleep(100)
      }
    }
  }
}
