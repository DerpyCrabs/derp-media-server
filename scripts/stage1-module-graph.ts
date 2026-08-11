import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'
import type { ViteManifest } from './service-worker-assets'

export const STAGE1_MODULE_GRAPH_FILE = '.vite/stage1-module-graph.json'

type ModuleGraphChunk = Readonly<{
  file: string
  modules: readonly string[]
}>

type ModuleGraphDocument = Readonly<{
  version: 1
  chunks: readonly ModuleGraphChunk[]
}>

function normalizedOutputPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\/+/, '')
}

function normalizedModuleId(root: string, id: string): string {
  if (id.startsWith('\0')) return `virtual:${id.slice(1).replaceAll('\\', '/')}`

  const queryIndex = id.indexOf('?')
  const pathname = queryIndex === -1 ? id : id.slice(0, queryIndex)
  const query = queryIndex === -1 ? '' : id.slice(queryIndex)
  if (!path.isAbsolute(pathname)) return `${pathname.replaceAll('\\', '/')}${query}`

  const relative = path.relative(root, pathname)
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return `${relative.replaceAll('\\', '/')}${query}`
  }
  return `${pathname.replaceAll('\\', '/')}${query}`
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}

function moduleGraphDocument(
  root: string,
  bundle: Record<string, { type: string; fileName: string; modules?: Record<string, unknown> }>,
): ModuleGraphDocument {
  const chunks = Object.values(bundle)
    .filter(
      (output): output is typeof output & { type: 'chunk'; modules: Record<string, unknown> } =>
        Boolean(output.type === 'chunk' && output.modules),
    )
    .map((chunk) => ({
      file: normalizedOutputPath(chunk.fileName),
      modules: sortedUnique(Object.keys(chunk.modules).map((id) => normalizedModuleId(root, id))),
    }))
    .sort((left, right) => (left.file < right.file ? -1 : left.file > right.file ? 1 : 0))

  return { version: 1, chunks }
}

export function stage1ModuleGraphPlugin(): Plugin {
  let root = process.cwd()
  return {
    name: 'stage1-module-graph',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      root = config.root
    },
    generateBundle(_options, bundle) {
      const document = moduleGraphDocument(root, bundle)
      this.emitFile({
        type: 'asset',
        fileName: STAGE1_MODULE_GRAPH_FILE,
        source: `${JSON.stringify(document, null, 2)}\n`,
      })
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSortedUnique(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]! < value)
}

function readModuleGraph(root: string): Map<string, readonly string[]> {
  const graphPath = path.join(root, STAGE1_MODULE_GRAPH_FILE)
  if (!fs.existsSync(graphPath)) {
    throw new Error('Stage 1 module graph missing from Vite build output')
  }
  const parsed: unknown = JSON.parse(fs.readFileSync(graphPath, 'utf8'))
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.chunks)) {
    throw new Error('Stage 1 module graph has unsupported schema')
  }

  const graph = new Map<string, readonly string[]>()
  let previousFile = ''
  for (const value of parsed.chunks) {
    if (
      !isRecord(value) ||
      typeof value.file !== 'string' ||
      !Array.isArray(value.modules) ||
      !value.modules.every((module) => typeof module === 'string')
    ) {
      throw new Error('Stage 1 module graph contains invalid chunk metadata')
    }
    const file = normalizedOutputPath(value.file)
    const modules = value.modules as string[]
    if (file !== value.file || previousFile >= file || !isSortedUnique(modules)) {
      throw new Error('Stage 1 module graph metadata is not deterministic')
    }
    previousFile = file
    graph.set(file, modules)
  }
  return graph
}

function staticRootChunkFiles(manifest: ViteManifest, entryKey: string): string[] {
  const files = new Set<string>()
  const visited = new Set<string>()
  const visit = (key: string) => {
    if (visited.has(key)) return
    visited.add(key)
    const chunk = manifest[key]
    if (!chunk) throw new Error(`Vite manifest references missing chunk: ${key}`)
    files.add(normalizedOutputPath(chunk.file))
    for (const imported of chunk.imports ?? []) visit(imported)
  }
  visit(entryKey)
  return [...files].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}

function matches(pattern: RegExp, value: string): boolean {
  pattern.lastIndex = 0
  const matched = pattern.test(value)
  pattern.lastIndex = 0
  return matched
}

export function assertStage1RootModuleIsolation(
  root: string,
  manifest: ViteManifest,
  entryKey: string,
  forbiddenSource: RegExp,
): void {
  const graph = readModuleGraph(root)
  const leaks: string[] = []
  for (const file of staticRootChunkFiles(manifest, entryKey)) {
    const modules = graph.get(file)
    if (!modules) throw new Error(`Stage 1 module graph missing static root chunk: ${file}`)
    for (const module of modules) {
      if (matches(forbiddenSource, module)) leaks.push(`${file} <- ${module}`)
    }
  }
  if (leaks.length > 0) {
    throw new Error(
      `Desktop or renderer implementation leaked into root closure: ${leaks.join(', ')}`,
    )
  }
}
