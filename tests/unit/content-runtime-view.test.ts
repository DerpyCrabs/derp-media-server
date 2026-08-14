import { describe, expect, test } from 'bun:test'

describe('ContentRuntimeView', () => {
  test('mounts through the neutral runtime and preserves a synchronous render owner', async () => {
    const source = await Bun.file('src/features/content/ContentRuntimeView.tsx').text()

    expect(source).toMatch(/props\.runtime\.mount/)
    expect(source).toMatch(/props\.runtime\.resolve/)
    expect(source).toMatch(/\(\) => props\.instance\(\) \?\? initial/)
    expect(source).toMatch(/props\.result\.render\(\)/)
    expect(source).toMatch(/createResource/)
    expect(source).toMatch(/Show when=\{source\(\)\}/)
    expect(source).toMatch(/ErrorBoundary/)
  })
})
