import { expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import applications from '../../desktop/applications.json'
import { pickerFileVisible } from '@/desktop/picker-files'
import type { PickerRequest } from '@/desktop/bridge'
import type { FileItem } from '@/lib/files/types'

test('each native viewer has an installed desktop entry and usable picker filter', () => {
  const packageScript = readFileSync('packaging/arch/PKGBUILD', 'utf8')
  expect(packageScript).toContain('packaging/arch/*.desktop')
  expect(new Set(applications.map((app) => app.id)).size).toBe(5)
  for (const app of applications) {
    const entry = readFileSync(`packaging/arch/derp-${app.id}.desktop`, 'utf8')
    expect(entry).toContain(`Exec=derp-media-client --viewer=${app.id} -- %U`)
    expect(entry).toMatch(/MimeType=.+;/)
    const request = {
      directory: false,
      filters: [{ rules: [{ patterns: app.patterns }] }],
    } as PickerRequest
    const file = {
      name: app.patterns[0]!.replace('*', 'Example').toUpperCase(),
      isDirectory: false,
    } as FileItem
    expect(pickerFileVisible(file, request, 0)).toBe(true)
    expect(pickerFileVisible({ ...file, name: 'unsupported.exe' }, request, 0)).toBe(false)
    expect(pickerFileVisible({ ...file, isDirectory: true }, request, 0)).toBe(true)
  }
})

test('launchers have distinct installed icons and consolidate archives and readers', () => {
  const entries = readdirSync('packaging/arch').filter((name) => name.endsWith('.desktop'))
  expect(entries).toHaveLength(6)
  const icons = entries.map((name) => {
    const entry = readFileSync(`packaging/arch/${name}`, 'utf8')
    const icon = /^Icon=(.+)$/m.exec(entry)![1]!
    expect(readFileSync(`desktop/icons/${icon}.svg`, 'utf8')).toContain('<svg')
    return icon
  })
  expect(new Set(icons).size).toBe(6)
  const files = readFileSync('packaging/arch/derp-media-client.desktop', 'utf8')
  expect(files).toContain('Name=Derp Files')
  expect(files).toContain('application/zip;')
  expect(files).not.toContain('application/pdf;')
  expect(applications.find((app) => app.id === 'reader')!.patterns).toEqual([
    '*.pdf',
    '*.epub',
    '*.fb2',
    '*.fb2.zip',
    '*.docx',
    '*.odt',
  ])
})
