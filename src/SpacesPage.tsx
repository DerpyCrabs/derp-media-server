import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { parseSpaceSummary, type Space, type SpaceSummary } from '@/lib/space'
import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import Clock3 from 'lucide-solid/icons/clock-3'
import Download from 'lucide-solid/icons/download'
import Map from 'lucide-solid/icons/map'
import Plus from 'lucide-solid/icons/plus'
import RotateCcw from 'lucide-solid/icons/rotate-ccw'
import Trash2 from 'lucide-solid/icons/trash-2'
import { For, Show, createMemo, createSignal } from 'solid-js'
import { followAppLink, hrefFor, hrefForSpace, navigateSpace } from './lib/routes'

type SpaceListResponse = { spaces: unknown[] }
type SpaceResponse = { space: Space }
type SpaceHistoryResponse = {
  history: Array<{ revision: number; deletedAt?: number }>
}

function newSpaceId() {
  return globalThis.crypto?.randomUUID?.() ?? `space-${Date.now()}`
}

export function SpacesPage() {
  const queryClient = useQueryClient()
  const [name, setName] = createSignal('')
  const [showDeleted, setShowDeleted] = createSignal(false)
  const spacesQuery = useQuery(() => ({
    queryKey: queryKeys.spaces(),
    queryFn: () => api<SpaceListResponse>('/api/spaces'),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  }))
  const spaces = createMemo(() =>
    (spacesQuery.data?.spaces ?? []).flatMap((value) => {
      const parsed = parseSpaceSummary(value)
      return parsed ? [parsed] : []
    }),
  )
  const activeSpaces = createMemo(() => spaces().filter((space) => space.deletedAt === undefined))
  const deletedSpaces = createMemo(() => spaces().filter((space) => space.deletedAt !== undefined))

  const commandMutation = useMutation(() => ({
    mutationFn: (body: unknown) =>
      api<SpaceResponse>('/api/spaces/commands', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.spaces() }),
  }))

  async function exportImportSources() {
    const records = await api<{ imports: unknown[] }>('/api/spaces/import-export')
    const blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'space-import-sources.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  async function createSpace(event: SubmitEvent) {
    event.preventDefault()
    const trimmed = name().trim()
    if (!trimmed) return
    const id = newSpaceId()
    const response = await commandMutation.mutateAsync({
      command: {
        type: 'create',
        id,
        name: trimmed,
        origin: 'canvas',
        panes: {},
        arrangements: { spatial: { placements: {} } },
      },
    })
    setName('')
    navigateSpace(response.space.id)
  }

  async function deleteSpace(space: SpaceSummary) {
    if (!window.confirm(`Delete “${space.name}”? Files inside panes remain untouched.`)) return
    await commandMutation.mutateAsync({
      spaceId: space.id,
      expectedRevision: space.revision,
      command: { type: 'delete' },
    })
  }

  async function restoreDeletedSpace(space: SpaceSummary) {
    const response = await api<SpaceHistoryResponse>(
      `/api/spaces/by-id/~${encodeURIComponent(space.id)}/history`,
    )
    const revision = [...response.history]
      .sort((left, right) => right.revision - left.revision)
      .find((item) => item.deletedAt === undefined)?.revision
    if (revision === undefined) return
    await commandMutation.mutateAsync({
      spaceId: space.id,
      expectedRevision: space.revision,
      command: { type: 'restoreRevision', revision },
    })
  }

  return (
    <main class='mx-auto w-full max-w-5xl p-4 pb-24 md:p-8' data-testid='spaces-page'>
      <div class='mb-6 flex flex-wrap items-start justify-between gap-3'>
        <div>
          <p class='text-muted-foreground text-sm font-medium'>Spaces</p>
          <h1 class='text-3xl font-semibold tracking-tight'>Durable work surfaces</h1>
          <p class='text-muted-foreground mt-2 max-w-2xl text-sm'>
            Durable Panes open here in Focus, Tiled, or Map presentation with revision history.
          </p>
        </div>
        <button
          type='button'
          class='inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted'
          onClick={() => void exportImportSources()}
        >
          <Download class='size-4' /> Export import sources
        </button>
      </div>

      <form class='mb-6 flex max-w-xl gap-2' onSubmit={createSpace}>
        <label class='sr-only' for='new-space-name'>
          Space name
        </label>
        <input
          id='new-space-name'
          data-testid='new-space-name'
          class='h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm'
          placeholder='New Space name'
          maxlength={120}
          value={name()}
          onInput={(event) => setName(event.currentTarget.value)}
        />
        <button
          type='submit'
          class='bg-primary text-primary-foreground inline-flex h-11 items-center gap-2 rounded-md px-4 text-sm font-medium disabled:opacity-50'
          disabled={!name().trim() || commandMutation.isPending}
        >
          <Plus class='size-4' /> Create
        </button>
      </form>

      <Show when={spacesQuery.isPending}>
        <p class='text-muted-foreground text-sm'>Loading Spaces…</p>
      </Show>
      <Show when={spacesQuery.isError}>
        <div class='border-destructive/40 bg-destructive/5 rounded-lg border p-4 text-sm'>
          <p>Spaces could not load.</p>
          <button class='mt-2 font-medium underline' onClick={() => void spacesQuery.refetch()}>
            Retry
          </button>
        </div>
      </Show>
      <Show when={!spacesQuery.isPending && activeSpaces().length === 0}>
        <div class='bg-card rounded-xl border border-dashed border-border p-8 text-center'>
          <Map class='text-muted-foreground mx-auto size-8' />
          <h2 class='mt-3 font-semibold'>No Spaces yet</h2>
          <p class='text-muted-foreground mt-1 text-sm'>
            Create one, or bring in legacy Canvas data.
          </p>
          <a
            href={hrefFor({ kind: 'canvas' })}
            class='mt-4 inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium'
            onClick={(event) => followAppLink(event, hrefFor({ kind: 'canvas' }))}
          >
            Import legacy Canvas
          </a>
        </div>
      </Show>
      <div class='grid gap-4 sm:grid-cols-2'>
        <For each={activeSpaces()}>
          {(space) => (
            <article class='bg-card rounded-xl border border-border p-5'>
              <a
                href={hrefForSpace(space.id)}
                class='block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                onClick={(event) => followAppLink(event, hrefForSpace(space.id))}
              >
                <div class='flex items-start gap-3'>
                  <Map class='text-primary mt-0.5 size-6 shrink-0' aria-hidden='true' />
                  <span class='min-w-0'>
                    <span class='block truncate text-lg font-semibold'>{space.name}</span>
                    <span class='text-muted-foreground mt-1 block text-sm'>
                      {space.paneCount} {space.paneCount === 1 ? 'pane' : 'panes'} · revision{' '}
                      {space.revision}
                    </span>
                  </span>
                </div>
              </a>
              <div class='mt-4 flex items-center justify-between border-t border-border pt-3'>
                <span class='text-muted-foreground text-xs'>Space</span>
                <div class='flex gap-1'>
                  <a
                    href={hrefForSpace(space.id, { history: true })}
                    class='inline-flex size-10 items-center justify-center rounded-md hover:bg-muted'
                    aria-label={`Revision history for ${space.name}`}
                    onClick={(event) =>
                      followAppLink(event, hrefForSpace(space.id, { history: true }))
                    }
                  >
                    <Clock3 class='size-4' />
                  </a>
                  <button
                    type='button'
                    class='inline-flex size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
                    aria-label={`Delete ${space.name}`}
                    onClick={() => void deleteSpace(space)}
                  >
                    <Trash2 class='size-4' />
                  </button>
                </div>
              </div>
            </article>
          )}
        </For>
      </div>

      <Show when={deletedSpaces().length > 0}>
        <section class='mt-8'>
          <button
            type='button'
            class='text-muted-foreground inline-flex min-h-11 items-center gap-2 text-sm font-medium'
            aria-expanded={showDeleted()}
            onClick={() => setShowDeleted((value) => !value)}
          >
            <Trash2 class='size-4' /> Deleted Spaces ({deletedSpaces().length})
          </button>
          <Show when={showDeleted()}>
            <div class='mt-2 space-y-2'>
              <For each={deletedSpaces()}>
                {(space) => (
                  <div class='bg-card flex items-center gap-3 rounded-lg border border-border p-3'>
                    <span class='min-w-0 flex-1 truncate text-sm'>{space.name}</span>
                    <button
                      type='button'
                      class='inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-medium hover:bg-muted'
                      onClick={() => void restoreDeletedSpace(space)}
                    >
                      <RotateCcw class='size-4' /> Restore
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </section>
      </Show>
    </main>
  )
}
