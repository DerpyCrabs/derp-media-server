import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const projectRoot = import.meta.dir.endsWith('/scripts')
  ? import.meta.dir.slice(0, -'/scripts'.length)
  : import.meta.dir
const target = join(projectRoot, 'lib/generated/api-contracts.ts')
const check = Bun.argv.includes('--check')
const temporary = check ? await mkdtemp(join(tmpdir(), 'derp-contracts-')) : null
const output = temporary ? join(temporary, 'api-contracts.ts') : target

async function run(command: string[]) {
  const child = Bun.spawn(command, {
    cwd: projectRoot,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const status = await child.exited
  if (status !== 0) process.exit(status)
}

try {
  await run(['cargo', 'run', '--quiet', '--', '--export-contracts', output])
  await run(['bun', 'x', 'oxfmt', output])
  if (check) {
    const [expected, actual] = await Promise.all([
      readFile(target, 'utf8').catch(() => ''),
      readFile(output, 'utf8'),
    ])
    if (expected !== actual) {
      console.error('Generated API contracts are stale. Run `bun run contracts:generate`.')
      process.exitCode = 1
    }
  }
} finally {
  if (temporary) await rm(temporary, { recursive: true, force: true })
}
