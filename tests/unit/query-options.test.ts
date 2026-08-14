import { describe, expect, test } from 'bun:test'
import type { QueryClient } from '@tanstack/solid-query'
import { VIRTUAL_FOLDERS } from '@/lib/constants'
import { fileMutationOptions, settingsMutationOptions } from '@/lib/query-options'

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
  test('file edits invalidate file listings and admin content', async () => {
    const { invalidated, queryClient } = recordingQueryClient()

    await runOnSettled(fileMutationOptions.edit(queryClient))

    expect(invalidated).toEqual([['files'], ['content', 'admin']])
  })

  test('file uploads invalidate file listings and admin content', async () => {
    const { invalidated, queryClient } = recordingQueryClient()

    await runOnSettled(fileMutationOptions.upload(queryClient))

    expect(invalidated).toEqual([['files'], ['content', 'admin']])
  })

  test('favorite changes invalidate settings and the Favorites listing', async () => {
    const { invalidated, queryClient } = recordingQueryClient()

    await runOnSettled(settingsMutationOptions.favorite(queryClient))

    expect(invalidated).toEqual([['settings'], ['files', VIRTUAL_FOLDERS.FAVORITES]])
  })

  test('view mode changes invalidate settings', async () => {
    const { invalidated, queryClient } = recordingQueryClient()

    await runOnSettled(settingsMutationOptions.viewMode(queryClient))

    expect(invalidated).toEqual([['settings']])
  })
})
