import { createHash } from 'node:crypto'

export type ViteManifestChunk = {
  file: string
  src?: string
  isEntry?: boolean
  isDynamicEntry?: boolean
  imports?: string[]
  dynamicImports?: string[]
  css?: string[]
  assets?: string[]
}

export type ViteManifest = Record<string, ViteManifestChunk>

export type BuildAssetPlan = Readonly<{
  buildId: string
  eager: readonly string[]
  offlineRenderers: readonly string[]
  optional: readonly string[]
}>

const readerSources = new Set(['src/reader/ReaderDialog.tsx', 'src/media/PdfViewerDialog.tsx'])

function assetPath(file: string): string {
  return `/${file.replaceAll('\\', '/').replace(/^\/+/, '')}`
}

function sourcePath(value: string | undefined): string {
  return value?.replaceAll('\\', '/').replace(/^.*?\/src\//, 'src/') ?? ''
}

function collectStaticAssets(
  manifest: ViteManifest,
  key: string,
  assets: Set<string>,
  visited: Set<string>,
): void {
  if (visited.has(key)) return
  visited.add(key)
  const chunk = manifest[key]
  if (!chunk) throw new Error(`Vite manifest references missing chunk: ${key}`)

  assets.add(assetPath(chunk.file))
  for (const file of chunk.css ?? []) assets.add(assetPath(file))
  for (const file of chunk.assets ?? []) assets.add(assetPath(file))
  for (const imported of chunk.imports ?? []) {
    collectStaticAssets(manifest, imported, assets, visited)
  }
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort()
}

function isReaderEntry(key: string, chunk: ViteManifestChunk): boolean {
  return readerSources.has(sourcePath(key)) || readerSources.has(sourcePath(chunk.src))
}

function isRendererWorker(path: string): boolean {
  const name = path.split('/').at(-1) ?? ''
  return /^(?:book-worker|pdf\.worker(?:\.min)?)-[^/]+\.(?:js|mjs)$/.test(name)
}

function isEagerWorker(path: string): boolean {
  return /\/sse-shared-worker-[^/]+\.js$/.test(path)
}

function isImmutableBuildAsset(path: string): boolean {
  return /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[^/]+$/.test(path)
}

function assertDisjoint(groups: readonly (readonly string[])[]): void {
  const seen = new Set<string>()
  for (const group of groups) {
    for (const path of group) {
      if (seen.has(path)) throw new Error(`Build asset assigned to multiple groups: ${path}`)
      seen.add(path)
    }
  }
}

function buildIdentity(groups: readonly (readonly string[])[], contentFingerprint: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ groups, contentFingerprint }))
    .digest('hex')
    .slice(0, 16)
}

export function buildAssetPlan(
  manifest: ViteManifest,
  emittedAssetPaths: Iterable<string>,
  shellAssetPaths: Iterable<string>,
  contentFingerprint = '',
): BuildAssetPlan {
  const emitted = new Set([...emittedAssetPaths].map(assetPath))
  const eagerSet = new Set<string>()
  const entryKeys = Object.entries(manifest)
    .filter(([, chunk]) => chunk.isEntry)
    .map(([key]) => key)
  if (entryKeys.length === 0) throw new Error('Vite entry missing from manifest')
  for (const key of entryKeys) collectStaticAssets(manifest, key, eagerSet, new Set())
  for (const path of shellAssetPaths) {
    const normalized = assetPath(path)
    if (normalized !== '/index.html') eagerSet.add(normalized)
  }
  for (const path of emitted) {
    if (isEagerWorker(path)) eagerSet.add(path)
  }

  const rendererSet = new Set<string>()
  const readerEntries = Object.entries(manifest).filter(([key, chunk]) => isReaderEntry(key, chunk))
  if (readerEntries.length === 0) {
    throw new Error('ReaderDialog dynamic entry missing from Vite manifest')
  }
  for (const [key] of readerEntries) {
    collectStaticAssets(manifest, key, rendererSet, new Set())
  }
  for (const path of emitted) {
    if (isRendererWorker(path)) rendererSet.add(path)
  }
  for (const path of eagerSet) rendererSet.delete(path)

  const optionalSet = new Set<string>()
  for (const path of emitted) {
    if (isImmutableBuildAsset(path) && !eagerSet.has(path) && !rendererSet.has(path)) {
      optionalSet.add(path)
    }
  }

  const eager = sorted([...eagerSet].filter((path) => emitted.has(path)))
  const offlineRenderers = sorted([...rendererSet].filter((path) => emitted.has(path)))
  const optional = sorted(optionalSet)
  assertDisjoint([eager, offlineRenderers, optional])

  return Object.freeze({
    buildId: buildIdentity([eager, offlineRenderers, optional], contentFingerprint),
    eager: Object.freeze(eager),
    offlineRenderers: Object.freeze(offlineRenderers),
    optional: Object.freeze(optional),
  })
}
