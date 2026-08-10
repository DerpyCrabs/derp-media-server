import { expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { BATCHES } from '../run-batches'

const E2E_DIR = path.resolve(import.meta.dir, '../e2e')

function e2eSpecNames(): string[] {
  return fs
    .readdirSync(E2E_DIR)
    .filter((file) => file.endsWith('.spec.ts'))
    .map((file) => file.replace(/\.spec\.ts$/, ''))
    .sort()
}

test('e2e batch manifest covers every existing spec exactly once', () => {
  const listed = BATCHES.flatMap((batch) => batch.tests)
  const existing = e2eSpecNames()
  const counts = new Map<string, number>()

  for (const name of listed) {
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }

  expect(BATCHES.length).toBeLessThanOrEqual(6)
  expect([...new Set(listed)].sort()).toEqual(existing)
  expect([...counts.entries()].filter(([, count]) => count !== 1)).toEqual([])
  expect(listed.every((name) => fs.existsSync(path.join(E2E_DIR, `${name}.spec.ts`)))).toBe(true)
})
