import { describe, expect, test } from 'bun:test'
import {
  blobToBase64,
  formatObsidianPastedImageFileName,
  spliceString,
} from '@/lib/pasted-kb-image'

describe('formatObsidianPastedImageFileName', () => {
  test('uses YYYYMMDDHHmmss stamp and png for empty / unknown mime', () => {
    const name = formatObsidianPastedImageFileName('')
    expect(name).toMatch(/^Pasted image \d{14}\.png$/)
  })

  test('maps common image mime types to extensions', () => {
    expect(formatObsidianPastedImageFileName('image/png')).toMatch(/\.png$/)
    expect(formatObsidianPastedImageFileName('image/jpeg')).toMatch(/\.jpg$/)
    expect(formatObsidianPastedImageFileName('image/jpg')).toMatch(/\.jpg$/)
    expect(formatObsidianPastedImageFileName('image/gif')).toMatch(/\.gif$/)
    expect(formatObsidianPastedImageFileName('image/webp')).toMatch(/\.webp$/)
  })
})

describe('blobToBase64', () => {
  test('round-trips small binary payload', async () => {
    const bytes = new Uint8Array([0, 1, 2, 255])
    const b64 = await blobToBase64(new Blob([bytes]))
    expect(b64).toBe(btoa(String.fromCharCode(0, 1, 2, 255)))
  })
})

describe('spliceString', () => {
  test('inserts at caret range', () => {
    expect(spliceString('hello world', 5, 6, ',')).toBe('hello,world')
  })

  test('replaces selection', () => {
    expect(spliceString('abcdef', 1, 4, 'X')).toBe('aXef')
  })
})
