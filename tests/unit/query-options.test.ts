import { describe, expect, test } from 'bun:test'
import type { QueryClient } from '@tanstack/solid-query'
import { settingsMutationOptions } from '@/lib/query-options'

function recordingQueryClient() {
  const invalidated: (readonly unknown[])[] = []
  const queryClient = {
    invalidateQueries: (filters: { queryKey: readonly unknown[] }) => {
      invalidated.push(filters.queryKey)
      return Promise.resolve()
    },
  } as unknown as QueryClient
  return { invalidated, queryClient }
}

async function runOnSettled(options: { onSettled?: unknown }) {
  await (options.onSettled as () => unknown)()
}

describe('canonical mutation invalidation', () => {
  test('favorite changes invalidate settings and resource listings', async () => {
    const { invalidated, queryClient } = recordingQueryClient()

    await runOnSettled(settingsMutationOptions.favorite(queryClient))

    expect(invalidated).toEqual([['settings'], ['files']])
  })

  test('view mode changes invalidate settings', async () => {
    const { invalidated, queryClient } = recordingQueryClient()

    await runOnSettled(settingsMutationOptions.viewMode(queryClient))

    expect(invalidated).toEqual([['settings']])
  })
})
