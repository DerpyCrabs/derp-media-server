import { test, expect } from 'bun:test'
import { parseMcpConfig } from '@/lib/config'

test('parseMcpConfig accepts Cursor-style server map', () => {
  const cfg = parseMcpConfig({
    mcp: {
      servers: {
        vkusvill: { url: 'https://mcp001.vkusvill.ru/mcp' },
        other: { url: 'http://127.0.0.1:3000/mcp' },
      },
    },
  })
  expect(cfg?.servers.vkusvill.url).toBe('https://mcp001.vkusvill.ru/mcp')
  expect(cfg?.servers.other.url).toBe('http://127.0.0.1:3000/mcp')
})

test('parseMcpConfig drops invalid URLs and empty keys', () => {
  const cfg = parseMcpConfig({
    mcp: {
      servers: {
        '': { url: 'http://x.test/mcp' },
        bad: { url: 'not a url' },
        good: { url: 'https://example.com/mcp' },
      },
    },
  })
  expect(Object.keys(cfg?.servers ?? {})).toEqual(['good'])
})

test('parseMcpConfig returns undefined when empty or missing', () => {
  expect(parseMcpConfig({})).toBeUndefined()
  expect(parseMcpConfig({ mcp: {} })).toBeUndefined()
  expect(parseMcpConfig({ mcp: { servers: {} } })).toBeUndefined()
})
