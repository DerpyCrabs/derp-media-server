import fs from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import budgets from '../stage1-performance-budgets.json'
import type { BuildAssetPlan, ViteManifest } from './service-worker-assets'
import { assertStage1RootModuleIsolation } from './stage1-module-graph'

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

function generatedConstant<T>(source: string, name: string): T {
  const serialized = source.match(new RegExp(`const ${name} = ([^\\n]+)`))?.[1]
  if (!serialized) throw new Error(`Generated service worker ${name} missing`)
  return JSON.parse(serialized) as T
}

function normalizedSource(key: string, src: string | undefined): string {
  return (src || key).replaceAll('\\', '/')
}

export function checkStage1AssetPlan(
  root: string,
  manifest: ViteManifest,
  workerSource: string,
): BuildAssetPlan {
  const plan = JSON.parse(
    fs.readFileSync(path.join(root, '.vite', 'service-worker-assets.json'), 'utf8'),
  ) as BuildAssetPlan
  const workerBuildId = generatedConstant<string>(workerSource, 'BUILD_ID')
  const workerPrecache = generatedConstant<string[]>(workerSource, 'PRECACHE')
  const workerOptional = generatedConstant<string[]>(workerSource, 'OPTIONAL')
  const expectedPrecache = [...plan.eager, ...plan.offlineRenderers].sort()

  if (!/^[a-f0-9]{16}$/.test(plan.buildId) || workerBuildId !== plan.buildId) {
    throw new Error('Generated service worker build ID does not match BuildAssetPlan')
  }
  if (JSON.stringify(workerPrecache) !== JSON.stringify(expectedPrecache)) {
    throw new Error('Generated service worker precache does not match BuildAssetPlan')
  }
  if (JSON.stringify(workerOptional) !== JSON.stringify(plan.optional)) {
    throw new Error('Generated service worker optional assets do not match BuildAssetPlan')
  }
  if (!workerPrecache.includes('/offline-shell.html') || workerPrecache.includes('/index.html')) {
    throw new Error('Service worker must precache only unspecialized navigation shell')
  }
  const offlineShell = fs.readFileSync(path.join(root, 'offline-shell.html'), 'utf8')
  if (offlineShell.includes('<!--DEHYDRATED-->') || /__DEHYDRATED_STATE__\s*=/.test(offlineShell)) {
    throw new Error('Offline shell contains personalized dehydration seam')
  }

  const allGroups = [...plan.eager, ...plan.offlineRenderers, ...plan.optional]
  if (new Set(allGroups).size !== allGroups.length) {
    throw new Error('BuildAssetPlan groups overlap')
  }
  for (const asset of allGroups) {
    if (!fs.existsSync(path.join(root, asset.replace(/^\//, '')))) {
      throw new Error(`BuildAssetPlan references missing asset: ${asset}`)
    }
  }
  for (const asset of plan.optional) {
    if (!/^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[^/]+$/.test(asset)) {
      throw new Error(`Optional runtime asset is not content-hashed: ${asset}`)
    }
  }

  const desktopSource =
    /(?:Workspace|Canvas|Hermes|MarkdownDocument|Editor|Settings|OfflineManager)/i
  const optional = new Set(plan.optional)
  for (const [key, chunk] of Object.entries(manifest)) {
    if (!chunk.isDynamicEntry || !desktopSource.test(normalizedSource(key, chunk.src))) continue
    const asset = `/${chunk.file}`
    if (!optional.has(asset)) {
      throw new Error(`Desktop-only dynamic entry must remain optional: ${asset}`)
    }
  }
  return plan
}

export function measureStage1Build(root = path.resolve('dist/client')): ByteMetrics {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, '.vite', 'manifest.json'), 'utf8'),
  ) as ViteManifest
  const entry = Object.entries(manifest).find(([, chunk]) => chunk.isEntry)
  if (!entry) throw new Error('Vite entry missing from manifest')

  const forbiddenRootSource = new RegExp(
    [
      'src/(?:WorkspacePage|CanvasPage|SettingsPage|MountsDialog)\\.tsx',
      'src/workspace/Hermes[^/]*\\.tsx',
      'src/reader/(?:ReaderDialog|ReaderOutline|ReaderSelectionMenu|BookContent|MarkdownContent|book-[^/]+)\\.(?:ts|tsx)',
      'src/media/(?:PdfViewerDialog|MarkdownDocument|TextViewerDialog|ImageViewerDialog|UnsupportedFileViewerDialog)\\.tsx',
      'src/media/markdown/(?!types\\.ts)',
      'src/file-browser/IconEditorDialog\\.tsx',
      'src/offline/OfflineManager\\.tsx',
    ].join('|'),
    'i',
  )
  assertStage1RootModuleIsolation(root, manifest, entry[0], forbiddenRootSource)

  const entryMetrics = fileMetrics(root, [entry[1].file])
  const eagerMetrics = fileMetrics(root, staticClosure(manifest, entry[0]))
  const workerSource = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8')
  const plan = checkStage1AssetPlan(root, manifest, workerSource)
  const precache = [...plan.eager, ...plan.offlineRenderers]
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
