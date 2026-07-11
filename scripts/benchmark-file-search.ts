import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
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
const indexPath = path.join(benchmarkRoot, 'index', 'files.sqlite')
const keepFiles = process.env.FILE_SEARCH_BENCHMARK_KEEP === '1' || !!providedRoot

type RpcResponse = { id: number; ok: boolean; data?: unknown; error?: string }

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

function createRpc(worker: Worker) {
  let nextId = 0
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  worker.addEventListener('message', (event: MessageEvent<RpcResponse>) => {
    const response = event.data
    const request = pending.get(response.id)
    if (!request) return
    pending.delete(response.id)
    if (response.ok) request.resolve(response.data)
    else request.reject(new Error(response.error ?? 'Worker request failed'))
  })
  return <T>(type: string, payload: Record<string, unknown> = {}) =>
    new Promise<T>((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve: (value) => resolve(value as T), reject })
      worker.postMessage({ id, type, ...payload })
    })
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

let worker: Worker | undefined
let httpServer: ReturnType<typeof Bun.serve> | undefined

try {
  const generationStarted = performance.now()
  await generateFiles()
  const generationMs = performance.now() - generationStarted

  worker = new Worker(new URL('../server/file-search-worker.ts', import.meta.url).href)
  const rpc = createRpc(worker)
  let peakRss = process.memoryUsage.rss()
  const rssTimer = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage.rss())
  }, 50)

  httpServer = Bun.serve({ port: 0, fetch: () => new Response('ok') })
  const httpLatencies: number[] = []
  let probing = true
  const probe = (async () => {
    while (probing) {
      const started = performance.now()
      await fetch(`http://127.0.0.1:${httpServer!.port}/`)
      httpLatencies.push(performance.now() - started)
      await Bun.sleep(25)
    }
  })()

  const buildStarted = performance.now()
  await rpc('init', {
    config: {
      enabled: true,
      indexPath,
      watchMode: 'off',
      maxRecursiveWatchers: 0,
      maxFsConcurrency: 4,
      reconcileDirectoriesPerSecond: 128,
    },
    roots: [{ id: 'benchmark', name: 'Benchmark', path: mediaRoot, source: 'config' }],
  })

  let status: FileSearchStatus
  do {
    await Bun.sleep(100)
    status = await rpc<FileSearchStatus>('status')
  } while (status.state === 'building' || status.state === 'starting')
  const buildMs = performance.now() - buildStarted
  probing = false
  await probe

  const queryLatencies: number[] = []
  const queries = ['file-000', '000123', 'txt', 'directory-000']
  for (let index = 0; index < 100; index++) {
    const started = performance.now()
    await rpc<FileSearchResponse>('search', { query: queries[index % queries.length], limit: 50 })
    queryLatencies.push(performance.now() - started)
  }

  await rpc('shutdown')
  clearInterval(rssTimer)
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
        peakRssMB: round(peakRss / 1024 / 1024),
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
  httpServer?.stop(true)
  worker?.terminate()
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
