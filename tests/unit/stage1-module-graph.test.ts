import { afterEach, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  STAGE1_MODULE_GRAPH_FILE,
  assertStage1RootModuleIsolation,
  stage1ModuleGraphPlugin,
} from '../../scripts/stage1-module-graph'
import type { ViteManifest } from '../../scripts/service-worker-assets'

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'derp-stage1-module-graph-'))
  tempRoots.push(root)
  return root
}

function emitGraph(root: string, entryModules: string[], sharedModules: string[] = []): string {
  const plugin = stage1ModuleGraphPlugin()
  const configResolved = plugin.configResolved
  if (typeof configResolved !== 'function') {
    throw new Error('configResolved must be a plain plugin hook')
  }
  const resolveConfig = configResolved as unknown as (config: { root: string }) => void
  resolveConfig({ root })

  let source = ''
  const context = {
    emitFile(file: { type: string; fileName?: string; source?: string | Uint8Array }) {
      expect(file.type).toBe('asset')
      expect(file.fileName).toBe(STAGE1_MODULE_GRAPH_FILE)
      source = String(file.source)
      return 'module-graph-reference'
    },
  }
  const generateBundle = plugin.generateBundle
  if (typeof generateBundle !== 'function') {
    throw new Error('generateBundle must be a plain plugin hook')
  }
  const generate = generateBundle as unknown as (
    this: typeof context,
    options: unknown,
    bundle: unknown,
    isWrite: boolean,
  ) => void
  generate.call(
    context,
    {} as never,
    {
      entry: {
        type: 'chunk',
        fileName: 'assets/index-entry.js',
        modules: Object.fromEntries(entryModules.map((id) => [id, {}])),
      },
      shared: {
        type: 'chunk',
        fileName: 'assets/shared-static.js',
        modules: Object.fromEntries(sharedModules.map((id) => [id, {}])),
      },
      ignoredAsset: { type: 'asset', fileName: 'assets/app.css', source: '' },
    },
    false,
  )
  return source
}

const manifest: ViteManifest = {
  'src/main.tsx': {
    file: 'assets/index-entry.js',
    isEntry: true,
    imports: ['_shared-static.js'],
  },
  '_shared-static.js': { file: 'assets/shared-static.js' },
}

test('module graph emission is project-relative and deterministic', () => {
  const root = tempRoot()
  const source = emitGraph(
    root,
    [path.join(root, 'src/z.ts'), path.join(root, 'src/App.tsx')],
    [path.join(root, 'node_modules/pkg/index.js')],
  )

  expect(source).toBe(
    `${JSON.stringify(
      {
        version: 1,
        chunks: [
          {
            file: 'assets/index-entry.js',
            modules: ['src/App.tsx', 'src/z.ts'],
          },
          {
            file: 'assets/shared-static.js',
            modules: ['node_modules/pkg/index.js'],
          },
        ],
      },
      null,
      2,
    )}\n`,
  )
})

test('root isolation checks modules bundled directly into every static chunk', () => {
  const root = tempRoot()
  const graphPath = path.join(root, STAGE1_MODULE_GRAPH_FILE)
  fs.mkdirSync(path.dirname(graphPath), { recursive: true })
  fs.writeFileSync(
    graphPath,
    emitGraph(root, [path.join(root, 'src/App.tsx'), path.join(root, 'src/SettingsPage.tsx')]),
  )

  expect(() =>
    assertStage1RootModuleIsolation(root, manifest, 'src/main.tsx', /SettingsPage/),
  ).toThrow(
    'Desktop or renderer implementation leaked into root closure: assets/index-entry.js <- src/SettingsPage.tsx',
  )

  fs.writeFileSync(
    graphPath,
    emitGraph(
      root,
      [path.join(root, 'src/App.tsx')],
      [path.join(root, 'src/reader/ReaderDialog.tsx')],
    ),
  )
  expect(() =>
    assertStage1RootModuleIsolation(root, manifest, 'src/main.tsx', /ReaderDialog/),
  ).toThrow(
    'Desktop or renderer implementation leaked into root closure: assets/shared-static.js <- src/reader/ReaderDialog.tsx',
  )
  expect(() =>
    assertStage1RootModuleIsolation(root, manifest, 'src/main.tsx', /WorkspacePage/),
  ).not.toThrow()
})

test('root isolation rejects stale metadata missing a static chunk', () => {
  const root = tempRoot()
  const graphPath = path.join(root, STAGE1_MODULE_GRAPH_FILE)
  fs.mkdirSync(path.dirname(graphPath), { recursive: true })
  const document = JSON.parse(emitGraph(root, [path.join(root, 'src/App.tsx')]))
  document.chunks = document.chunks.filter(
    (chunk: { file: string }) => chunk.file !== 'assets/shared-static.js',
  )
  fs.writeFileSync(graphPath, `${JSON.stringify(document, null, 2)}\n`)

  expect(() =>
    assertStage1RootModuleIsolation(root, manifest, 'src/main.tsx', /ReaderDialog/),
  ).toThrow('Stage 1 module graph missing static root chunk: assets/shared-static.js')
})
