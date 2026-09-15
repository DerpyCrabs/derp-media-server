import { expect, test } from 'bun:test'
import { randomId } from '@/lib/random-id'

test('generates distinct version 4 UUIDs with the standard variant bits', () => {
  const ids = Array.from({ length: 100 }, () => randomId())
  expect(new Set(ids).size).toBe(ids.length)
  for (const id of ids) {
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  }
})
