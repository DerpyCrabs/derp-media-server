import fs from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import budgets from '../stage1-performance-budgets.json'
import type { ViteManifest } from './service-worker-assets'

type ByteMetrics = {
  rootEntryRawBytes: number
  rootEntryGzipBytes: number
  eagerClosureRawBytes: number
  eagerClosureGzipBytes: number
  installPrecacheFiles: number
  installPrecacheRawBytes: number
  installPrecacheGzipBytes: number
}

function fileMetrics(root: string, files: Iterable<string>) {
  let raw = 0
  let gzip = 0
  for (const relative of new Set(files)) {
    const body = fs.readFileSync(path.join(root, relative.replace(/^\//, '')))
    raw += body.byteLength
    gzip += gzipSync(body, { level: 9 }).byteLength
  }
  return { raw, gzip }
}

function staticClosure(manifest: ViteManifest, entryKey: string): string[] {
  const files = new Set<string>()
  const visited = new Set<string>()
  const visit = (key: string) => {
    if (visited.has(key)) return
    visited.add(key)
    const chunk = manifest[key]
    if (!chunk) throw new Error(`Vite manifest references missing chunk: ${key}`)
    files.add(chunk.file)
    for (const file of chunk.css ?? []) files.add(file)
    for (const file of chunk.assets ?? []) files.add(file)
    for (const imported of chunk.imports ?? []) visit(imported)
  }
  visit(entryKey)
  return [...files]
}

export function measureStage1Build(root = path.resolve('dist/client')): ByteMetrics {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, '.vite', 'manifest.json'), 'utf8'),
  ) as ViteManifest
  const entry = Object.entries(manifest).find(([, chunk]) => chunk.isEntry)
  if (!entry) throw new Error('Vite entry missing from manifest')

  const entryMetrics = fileMetrics(root, [entry[1].file])
  const eagerMetrics = fileMetrics(root, staticClosure(manifest, entry[0]))
  const workerSource = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8')
  const serializedPrecache = workerSource.match(/const PRECACHE = (\[[^\n]+\])/)?.[1]
  if (!serializedPrecache) throw new Error('Generated service worker precache list missing')
  const precache = JSON.parse(serializedPrecache) as string[]
  const precacheMetrics = fileMetrics(root, precache)

  return {
    rootEntryRawBytes: entryMetrics.raw,
    rootEntryGzipBytes: entryMetrics.gzip,
    eagerClosureRawBytes: eagerMetrics.raw,
    eagerClosureGzipBytes: eagerMetrics.gzip,
    installPrecacheFiles: precache.length,
    installPrecacheRawBytes: precacheMetrics.raw,
    installPrecacheGzipBytes: precacheMetrics.gzip,
  }
}

function checkMaximum(name: keyof ByteMetrics, measured: number) {
  const baseline = budgets.baseline[name]
  const delta = budgets.permittedStage1Delta[name as keyof typeof budgets.permittedStage1Delta]
  if (typeof baseline !== 'number' || typeof delta !== 'number') return
  const maximum = baseline + delta
  if (measured > maximum) {
    throw new Error(`Stage 1 budget exceeded: ${name}=${measured}, maximum=${maximum}`)
  }
}

if (import.meta.main) {
  const measured = measureStage1Build()
  checkMaximum('rootEntryGzipBytes', measured.rootEntryGzipBytes)
  checkMaximum('eagerClosureGzipBytes', measured.eagerClosureGzipBytes)
  checkMaximum('installPrecacheGzipBytes', measured.installPrecacheGzipBytes)
  console.log(`Stage 1 build budgets: ${JSON.stringify(measured)}`)
}
