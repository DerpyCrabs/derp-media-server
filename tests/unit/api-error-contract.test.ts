import { afterEach, describe, expect, test } from 'bun:test'
import { api, ApiError } from '@/lib/api'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('API error contract', () => {
  test('preserves tagged reconciliation failures', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            code: 'needsReconciliation',
            message: 'File moved but metadata repair failed',
            details: { operation: 'move', path: 'Notes/new.md' },
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )) as unknown as typeof fetch

    const error = await api('/api/integrations/filesystem/actions').catch(
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(ApiError)
    if (!(error instanceof ApiError)) throw new Error('Expected ApiError')
    expect(error.status).toBe(500)
    expect(error.code).toBe('needsReconciliation')
    expect(error.message).toBe('File moved but metadata repair failed')
    expect(error.details).toEqual({ operation: 'move', path: 'Notes/new.md' })
  })
})
