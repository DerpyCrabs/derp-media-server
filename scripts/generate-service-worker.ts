import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { markdownLazyAssetPaths, type ViteManifest } from './service-worker-assets'

const root = path.resolve('dist/client')
const manifestPath = path.join(root, '.vite', 'manifest.json')

async function collect(directory: string, excluded: ReadonlySet<string>): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) result.push(...(await collect(fullPath, excluded)))
    else {
      const assetPath = `/${path.relative(root, fullPath).replaceAll('\\', '/')}`
      if (
        entry.name !== 'service-worker.js' &&
        assetPath !== '/.vite/manifest.json' &&
        !excluded.has(assetPath)
      ) {
        result.push(assetPath)
      }
    }
  }
  return result
}

const workerPath = path.join(root, 'service-worker.js')
const source = await readFile(workerPath, 'utf8')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ViteManifest
const assets = await collect(root, markdownLazyAssetPaths(manifest))
await writeFile(workerPath, source.replace('/* __PRECACHE__ */ []', JSON.stringify(assets.sort())))
