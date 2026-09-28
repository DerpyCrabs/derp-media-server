import { mkdir, copyFile } from 'node:fs/promises'
await mkdir('dist/desktop', { recursive: true })
for (const entry of ['main', 'preload']) {
  const result = await Bun.build({
    entrypoints: [`desktop/${entry}.ts`],
    outdir: 'dist/desktop',
    target: 'node',
    format: 'cjs',
    naming: '[name].cjs',
    external: ['electron'],
    sourcemap: 'external',
  })
  if (!result.success) throw new AggregateError(result.logs, 'Desktop build failed')
}
await copyFile('desktop/icon.png', 'dist/desktop/icon.png')
