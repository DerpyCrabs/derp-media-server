import { describe, expect, test } from 'bun:test'

describe('verification commands', () => {
  test('exposes read-only fast and full verification tiers', async () => {
    const packageDocument = (await Bun.file('package.json').json()) as {
      scripts: Record<string, string>
    }

    expect(packageDocument.scripts.check).toContain('bun run tsgo')
    expect(packageDocument.scripts.check).toContain('bun run lint-errors')
    expect(packageDocument.scripts.check).toContain('cargo check')
    expect(packageDocument.scripts['test:conformance']).toContain(
      'integrations::conformance::tests',
    )
    expect(packageDocument.scripts['verify:fast']).toContain('bun run test:conformance')
    expect(packageDocument.scripts.verify).toContain('cargo test')
    expect(packageDocument.scripts.verify).toContain('bun run test:batch')

    const hook = await Bun.file('.husky/pre-commit').text()
    expect(hook.trim()).toBe('bun run check')
    expect(hook).not.toMatch(/git add|bun run fmt(?:\s|$)/)

    const { BATCHES } = await import('@/tests/run-batches')
    expect(BATCHES.length).toBeLessThanOrEqual(6)
    const batched = BATCHES.flatMap((batch) => batch.tests).sort()
    const browserSpecs: string[] = []
    for await (const relative of new Bun.Glob('*.spec.ts').scan('tests/e2e')) {
      browserSpecs.push(relative.replace(/\.spec\.ts$/, ''))
    }
    expect(new Set(batched).size).toBe(batched.length)
    expect(batched).toEqual(browserSpecs.sort())
  })

  test('documents each supported integration contribution workflow', async () => {
    const guide = await Bun.file('docs/integrations.md').text()
    for (const heading of [
      'Add an integration',
      'Add a resource action',
      'Add a search contributor',
      'Add a content renderer',
    ]) {
      expect(guide).toContain(heading)
    }
    expect(guide).toContain('bun run test:conformance')
    expect(guide).toContain('bun run verify:fast')
    expect(guide).toContain('bun run verify')
  })
})
