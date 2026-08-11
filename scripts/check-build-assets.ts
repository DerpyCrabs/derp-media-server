import fs from 'node:fs'
import path from 'node:path'
import type { BuildAssetPlan } from './service-worker-assets'

function generatedConstant<T>(source: string, name: string): T {
  const serialized = source.match(new RegExp(`const ${name} = ([^\\n]+)`))?.[1]
  if (!serialized) throw new Error(`Generated service worker ${name} missing`)
  return JSON.parse(serialized) as T
}

export function checkBuildAssets(root = path.resolve('dist/client')): BuildAssetPlan {
  const plan = JSON.parse(
    fs.readFileSync(path.join(root, '.vite', 'service-worker-assets.json'), 'utf8'),
  ) as BuildAssetPlan
  const workerSource = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8')
  const workerBuildId = generatedConstant<string>(workerSource, 'BUILD_ID')
  const workerPrecache = generatedConstant<string[]>(workerSource, 'PRECACHE')
  const workerOptional = generatedConstant<string[]>(workerSource, 'OPTIONAL')
  const expectedPrecache = [...plan.eager, ...plan.offlineRenderers].sort()

  if (!/^[a-f0-9]{16}$/.test(plan.buildId) || workerBuildId !== plan.buildId) {
    throw new Error('Generated service worker build ID does not match asset plan')
  }
  if (JSON.stringify(workerPrecache) !== JSON.stringify(expectedPrecache)) {
    throw new Error('Generated service worker precache does not match asset plan')
  }
  if (JSON.stringify(workerOptional) !== JSON.stringify(plan.optional)) {
    throw new Error('Generated service worker optional assets do not match asset plan')
  }
  if (!workerPrecache.includes('/offline-shell.html') || workerPrecache.includes('/index.html')) {
    throw new Error('Service worker must precache only unspecialized navigation shell')
  }

  const offlineShell = fs.readFileSync(path.join(root, 'offline-shell.html'), 'utf8')
  if (offlineShell.includes('<!--DEHYDRATED-->') || /__DEHYDRATED_STATE__\s*=/.test(offlineShell)) {
    throw new Error('Offline shell contains personalized dehydration state')
  }

  const allGroups = [...plan.eager, ...plan.offlineRenderers, ...plan.optional]
  if (new Set(allGroups).size !== allGroups.length) {
    throw new Error('Build asset groups overlap')
  }
  for (const asset of allGroups) {
    if (!fs.existsSync(path.join(root, asset.replace(/^\//, '')))) {
      throw new Error(`Build plan references missing asset: ${asset}`)
    }
  }
  for (const asset of plan.optional) {
    if (!/^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[^/]+$/.test(asset)) {
      throw new Error(`Optional runtime asset is not content-hashed: ${asset}`)
    }
  }

  return plan
}

if (import.meta.main) {
  checkBuildAssets()
  console.log('Build asset checks passed')
}
