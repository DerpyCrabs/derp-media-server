import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  fileUris,
  loadConfig,
  parseArguments,
  parseFileClipboard,
  validateConfig,
} from '../../desktop/core'

describe('desktop launch and clipboard inputs', () => {
  test('resolves CLI paths relative to the invoking process and preserves repeat requests', () => {
    expect(
      parseArguments(['a b.pdf', 'a b.pdf', 'file:///tmp/a%23b.pdf', '--', '-book.pdf'], '/media'),
    ).toEqual({
      tray: false,
      help: false,
      paths: ['/media/a b.pdf', '/media/a b.pdf', '/tmp/a#b.pdf', '/media/-book.pdf'],
    })
    expect(parseArguments(['--tray'], '/')).toEqual({ tray: true, help: false, paths: [] })
    expect(() => parseArguments(['--typo'], '/')).toThrow('Unknown option')
    expect(() => parseArguments(['file://remote/share'], '/')).toThrow()
  })

  test('accepts Nautilus copy/cut URI payloads without treating arbitrary text as filenames', () => {
    const paths = ['/tmp/a b.pdf', '/tmp/雪#%.txt']
    expect(parseFileClipboard('cut\n' + fileUris(paths))).toEqual(paths)
    expect(parseFileClipboard('# comment\nhttps://example.com/a\n/tmp/not-a-uri')).toEqual([])
    expect(() => parseFileClipboard('file://remote/share')).toThrow()
  })

  test('rejects invalid server ports', () => {
    for (const value of [null, {}, { port: '3000' }, { port: 0 }, { port: 65536 }, { port: 3.5 }])
      expect(() => validateConfig(value)).toThrow()
    expect(validateConfig({ port: 5973 })).toEqual({ port: 5973 })
  })

  test('creates a config only when absent and preserves user settings', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'derp-config-test-'))
    try {
      expect(await loadConfig(directory)).toEqual({ port: 3000 })
      await writeFile(path.join(directory, 'desktop.json'), '{"port":5973}\n')
      expect(await loadConfig(directory)).toEqual({ port: 5973 })
      expect(await readFile(path.join(directory, 'desktop.json'), 'utf8')).toBe('{"port":5973}\n')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
