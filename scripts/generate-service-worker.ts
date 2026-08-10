import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildAssetPlan, type BuildAssetPlan, type ViteManifest } from './service-worker-assets'

const defaultRoot = path.resolve('dist/client')

async function collect(directory: string, root: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) result.push(...(await collect(fullPath, root)))
    else {
      const assetPath = `/${path.relative(root, fullPath).replaceAll('\\', '/')}`
      if (
        entry.name !== 'service-worker.js' &&
        assetPath !== '/index.html' &&
        assetPath !== '/.vite/manifest.json' &&
        assetPath !== '/.vite/service-worker-assets.json'
      ) {
        result.push(assetPath)
      }
    }
  }
  return result
}

async function fingerprint(
  root: string,
  assetPaths: readonly string[],
  workerTemplate: string,
): Promise<string> {
  const hash = createHash('sha256')
  for (const assetPath of [...assetPaths].sort()) {
    hash.update(assetPath)
    hash.update(await readFile(path.join(root, assetPath.replace(/^\//, ''))))
  }
  hash.update(workerTemplate)
  return hash.digest('hex')
}

function localAssetPath(value: string): string | undefined {
  if (/^(?:data:|blob:|https?:|\/\/|#)/.test(value)) return
  const pathname = value.split(/[?#]/, 1)[0]
  if (!pathname || pathname === '/' || pathname === '/index.html') return
  return `/${pathname.replace(/^\.?\//, '').replace(/^\/+/, '')}`
}

function manifestAssetPaths(value: unknown, key?: string): string[] {
  if (typeof value === 'string') {
    const path = key === 'src' ? localAssetPath(value) : undefined
    return path ? [path] : []
  }
  if (Array.isArray(value)) return value.flatMap((item) => manifestAssetPaths(item))
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([childKey, child]) => manifestAssetPaths(child, childKey))
}

export function offlineShellHtml(indexHtml: string): string {
  const withoutPlaceholder = indexHtml.replaceAll(
    '<!--DEHYDRATED-->',
    '<!-- Offline shell intentionally contains no personalized dehydrated state. -->',
  )
  if (/__DEHYDRATED_STATE__\s*=/.test(withoutPlaceholder)) {
    throw new Error('Static index contains personalized dehydrated state')
  }
  return withoutPlaceholder
}

export function renderServiceWorker(template: string, plan: BuildAssetPlan): string {
  const precache = [...plan.eager, ...plan.offlineRenderers].sort()
  const replacements = [
    ["/* __BUILD_ID__ */ 'development'", JSON.stringify(plan.buildId)],
    ['/* __PRECACHE__ */ []', JSON.stringify(precache)],
    ['/* __OPTIONAL__ */ []', JSON.stringify(plan.optional)],
  ] as const
  let rendered = template
  for (const [placeholder, replacement] of replacements) {
    if (!rendered.includes(placeholder)) {
      throw new Error(`Service worker template placeholder missing: ${placeholder}`)
    }
    rendered = rendered.replace(placeholder, replacement)
  }
  return rendered
}

export async function generateServiceWorker(root = defaultRoot): Promise<BuildAssetPlan> {
  const manifestPath = path.join(root, '.vite', 'manifest.json')
  const workerPath = path.join(root, 'service-worker.js')
  const indexPath = path.join(root, 'index.html')
  const offlineShellPath = path.join(root, 'offline-shell.html')
  const indexHtml = await readFile(indexPath, 'utf8')
  const offlineShell = offlineShellHtml(indexHtml)
  await writeFile(offlineShellPath, offlineShell)

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ViteManifest
  const webManifestPath = path.join(root, 'manifest.webmanifest')
  const webManifest = JSON.parse(await readFile(webManifestPath, 'utf8')) as unknown
  const emitted = await collect(root, root)
  const emittedSet = new Set(emitted)
  const htmlReferences = [...indexHtml.matchAll(/(?:href|src)=["']([^"']+)["']/g)]
    .map((match) => localAssetPath(match[1]))
    .filter((value): value is string => Boolean(value))
  const referencedShellAssets = [
    '/offline-shell.html',
    '/manifest.webmanifest',
    ...htmlReferences,
    ...manifestAssetPaths(webManifest),
  ]
  const missingShellAssets = referencedShellAssets.filter((asset) => !emittedSet.has(asset))
  if (missingShellAssets.length > 0) {
    throw new Error(`Shell references missing build assets: ${missingShellAssets.join(', ')}`)
  }
  const source = await readFile(path.resolve('public/service-worker.js'), 'utf8')
  const plan = buildAssetPlan(
    manifest,
    emitted,
    referencedShellAssets,
    await fingerprint(root, emitted, source),
  )
  await writeFile(workerPath, renderServiceWorker(source, plan))
  await writeFile(
    path.join(root, '.vite', 'service-worker-assets.json'),
    `${JSON.stringify(plan, null, 2)}\n`,
  )
  return plan
}

if (import.meta.main) {
  const plan = await generateServiceWorker()
  console.log(
    `Service worker ${plan.buildId}: ${plan.eager.length} eager, ${plan.offlineRenderers.length} offline renderer, ${plan.optional.length} optional assets`,
  )
}
