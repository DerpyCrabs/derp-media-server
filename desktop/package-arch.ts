import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const version = (await Bun.file('package.json').json()).version as string
const name = `derp-media-client-${version}`
await mkdir('dist/arch', { recursive: true })
const archive = `dist/arch/${name}.tar.gz`
const tar = Bun.spawn(
  ['tar', '-czf', archive, '--transform', `s,^,${name}/,`, 'desktop', 'packaging/arch', 'LICENSE'],
  { stdout: 'inherit', stderr: 'inherit' },
)
if (await tar.exited) throw new Error('Could not create source archive')
await copyFile('packaging/arch/PKGBUILD', 'dist/arch/PKGBUILD')
const digest = createHash('sha256')
  .update(await readFile(archive))
  .digest('hex')
const template = await readFile('dist/arch/PKGBUILD', 'utf8')
await writeFile(
  'dist/arch/PKGBUILD',
  template
    .replace(/^pkgver=.*$/m, `pkgver=${version}`)
    .replace("sha256sums=('SKIP')", `sha256sums=('${digest}')`),
)
console.log('Arch package sources prepared. Run: cd dist/arch && makepkg -si')
