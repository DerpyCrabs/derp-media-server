import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(import.meta.dirname, '..')
const REACT_DIR = path.join(ROOT, 'tests', 'e2e')
const SOLID_DIR = path.join(ROOT, 'tests', 'e2e-solid')

function specBasenames(dir: string): Set<string> {
  const set = new Set<string>()
  if (!fs.existsSync(dir)) return set
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith('.spec.ts')) {
      set.add(name.replace(/\.spec\.ts$/, ''))
    }
  }
  return set
}

function main() {
  const react = specBasenames(REACT_DIR)
  const solid = specBasenames(SOLID_DIR)

  const reactOnly = [...react].filter((n) => !solid.has(n)).sort()
  const solidOnly = [...solid].filter((n) => !react.has(n)).sort()

  console.log('E2E spec basename diff (tests/e2e vs tests/e2e-solid)\n')
  console.log(`React specs: ${react.size}`)
  console.log(`Solid specs: ${solid.size}\n`)

  if (reactOnly.length) {
    console.log('React-only (port to e2e-solid when Solid implements the feature):')
    for (const n of reactOnly) console.log(`  - ${n}`)
    console.log('')
  } else {
    console.log('React-only: (none)\n')
  }

  if (solidOnly.length) {
    console.log('Solid-only (expected extras like smoke, or remove if obsolete):')
    for (const n of solidOnly) console.log(`  - ${n}`)
    console.log('')
  } else {
    console.log('Solid-only: (none)\n')
  }

  if (reactOnly.length) {
    console.log(
      'Tip: run `bun scripts/diff-e2e-specs.ts` after adding React specs to see missing Solid mirrors.',
    )
    process.exitCode = 1
  }
}

main()
