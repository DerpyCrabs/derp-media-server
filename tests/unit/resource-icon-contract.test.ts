import { describe, expect, test } from 'bun:test'

describe('resource icon contract', () => {
  test('consumes typed appearance without provider metadata parsing', async () => {
    const source = await Bun.file('src/lib/use-file-icon.tsx').text()

    expect(source).toContain('type ResourceAppearance')
    expect(source).toContain('resource.appearance?.icon?.trim()')
    expect(source).not.toContain('metadata?.appearance')
    expect(source).not.toContain('appearance as Record<string, unknown>')
  })
})
