import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve('dist/client')

async function collect(directory: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) result.push(...(await collect(fullPath)))
    else if (entry.name !== 'service-worker.js')
      result.push(`/${path.relative(root, fullPath).replaceAll('\\', '/')}`)
  }
  return result
}

const workerPath = path.join(root, 'service-worker.js')
const source = await readFile(workerPath, 'utf8')
const assets = await collect(root)
await writeFile(workerPath, source.replace('/* __PRECACHE__ */ []', JSON.stringify(assets.sort())))
