import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dir, '../..')

describe('Derp Desk install branding', () => {
  test('document and manifest expose branding while Library remains launch route', () => {
    const html = readFileSync(path.join(root, 'index.html'), 'utf8')
    const manifest = JSON.parse(
      readFileSync(path.join(root, 'public/manifest.webmanifest'), 'utf8'),
    ) as {
      name: string
      short_name: string
      description: string
      start_url: string
      icons: { src: string; purpose: string }[]
    }

    expect(html).toContain('<title>Derp Desk</title>')
    expect(html).toContain('name="referrer" content="no-referrer"')
    expect(manifest.name).toBe('Derp Desk')
    expect(manifest.short_name).toBe('Derp Desk')
    expect(manifest.description).toContain('private desk')
    expect(manifest.start_url).toBe('/')
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true)
    for (const icon of manifest.icons) {
      expect(readFileSync(path.join(root, 'public', icon.src.slice(1)), 'utf8')).toContain('<svg')
    }
  })
})
