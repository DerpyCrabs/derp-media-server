import { describe, expect, test } from 'bun:test'
import {
  buildOfflineRollbackPlan,
  executeOfflineDownload,
} from '@/src/lib/offline-download-lifecycle'

describe('offline download lifecycle Interface', () => {
  test('does not run cleanup after success', async () => {
    let cleanupCalls = 0
    const outcome = await executeOfflineDownload(
      async () => undefined,
      async () => {
        cleanupCalls += 1
      },
    )

    expect(outcome).toEqual({ kind: 'succeeded' })
    expect(cleanupCalls).toBe(0)
  })

  test('returns original operation error after successful cleanup', async () => {
    const original = new TypeError('network failed')
    const outcome = await executeOfflineDownload(
      async () => {
        throw original
      },
      async () => undefined,
    )

    expect(outcome).toEqual({ kind: 'failed', error: original })
  })

  test('preserves original error when cleanup also fails', async () => {
    const original = new DOMException('cancelled', 'AbortError')
    const cleanup = new Error('IndexedDB cleanup failed')
    const outcome = await executeOfflineDownload(
      async () => {
        throw original
      },
      async () => {
        throw cleanup
      },
    )

    expect(outcome).toEqual({ kind: 'failed', error: original, cleanupError: cleanup })
  })

  test('restores overwritten entries and discards only replacement physical files', () => {
    const previous = [
      { path: 'Docs', isDirectory: true },
      { path: 'Docs/kept.txt', fileName: 'offline-old' },
      { path: 'Elsewhere.txt', fileName: 'offline-elsewhere' },
    ]
    const current = [
      { path: 'Docs', isDirectory: true },
      { path: 'Docs/kept.txt', fileName: 'offline-new' },
      { path: 'Docs/new.txt', fileName: 'offline-new-child' },
      previous[2],
    ]

    const plan = buildOfflineRollbackPlan(previous, current, [
      'Docs',
      'Docs/kept.txt',
      'Docs/new.txt',
      'Docs/new.txt',
    ])

    expect(plan.deletePaths).toEqual(['Docs', 'Docs/kept.txt', 'Docs/new.txt'])
    expect(plan.restore).toEqual(previous.slice(0, 2))
    expect(plan.discardPhysical.map((entry) => entry.fileName)).toEqual([
      'offline-new',
      'offline-new-child',
    ])
  })
})
