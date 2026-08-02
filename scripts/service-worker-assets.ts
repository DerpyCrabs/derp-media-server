export type ViteManifestChunk = {
  file: string
  src?: string
  isEntry?: boolean
  imports?: string[]
  css?: string[]
  assets?: string[]
}

export type ViteManifest = Record<string, ViteManifestChunk>

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

  assets.add(`/${chunk.file}`)
  for (const file of chunk.css ?? []) assets.add(`/${file}`)
  for (const file of chunk.assets ?? []) assets.add(`/${file}`)
  for (const imported of chunk.imports ?? []) {
    collectStaticAssets(manifest, imported, assets, visited)
  }
}

export function markdownLazyAssetPaths(manifest: ViteManifest): Set<string> {
  const isMarkdownEntry = (value: string | undefined) => {
    const normalized = value?.replaceAll('\\', '/')
    return (
      normalized === 'src/media/MarkdownDocument.tsx' ||
      normalized?.endsWith('/src/media/MarkdownDocument.tsx') === true
    )
  }
  const markdownEntry = Object.entries(manifest).find(
    ([key, chunk]) => isMarkdownEntry(key) || isMarkdownEntry(chunk.src),
  )
  if (!markdownEntry) throw new Error('MarkdownDocument dynamic entry missing from Vite manifest')

  const markdownAssets = new Set<string>()
  collectStaticAssets(manifest, markdownEntry[0], markdownAssets, new Set())

  const eagerAssets = new Set<string>()
  for (const [key, chunk] of Object.entries(manifest)) {
    if (chunk.isEntry) collectStaticAssets(manifest, key, eagerAssets, new Set())
  }

  return new Set([...markdownAssets].filter((asset) => !eagerAssets.has(asset)))
}
