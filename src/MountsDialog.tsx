import { api, post } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import FolderPlus from 'lucide-solid/icons/folder-plus'
import Pencil from 'lucide-solid/icons/pencil'
import Trash from 'lucide-solid/icons/trash-2'
import { For, Show, createEffect, createSignal } from 'solid-js'

type Mount = {
  id: string
  name: string
  path: string
  createdAt: number
  readOnly: true
  status: 'online' | 'offline'
  shareCount: number
}

export function MountsDialog(props: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = createSignal<Mount | null>(null)
  const [name, setName] = createSignal('')
  const [mountPath, setMountPath] = createSignal('')

  const mountsQuery = useQuery(() => ({
    queryKey: queryKeys.mounts(),
    queryFn: () => api<{ mounts: Mount[] }>('/api/admin/mounts'),
    enabled: props.open,
  }))

  const saveMutation = useMutation(() => ({
    mutationFn: () => {
      const current = editing()
      return current
        ? api(`/api/admin/mounts/${current.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ name: name(), path: mountPath() }),
          })
        : post('/api/admin/mounts', { name: name(), path: mountPath() })
    },
    onSuccess: async () => {
      setEditing(null)
      setName('')
      setMountPath('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.mounts() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.authConfig() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.files() }),
      ])
    },
  }))

  const deleteMutation = useMutation(() => ({
    mutationFn: (mount: Mount) => api(`/api/admin/mounts/${mount.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.mounts() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.authConfig() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.files() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.shares() }),
      ])
    },
  }))

  createEffect(() => {
    if (!props.open) {
      setEditing(null)
      saveMutation.reset()
    }
  })

  return (
    <Show when={props.open}>
      <div
        class='fixed inset-0 z-10010 flex items-center justify-center bg-black/50 p-4'
        onClick={props.onClose}
      >
        <div
          role='dialog'
          aria-modal='true'
          aria-labelledby='mounts-title'
          class='w-full max-w-2xl rounded-xl border border-border bg-background p-5 text-foreground shadow-xl'
          onClick={(event) => event.stopPropagation()}
        >
          <div class='mb-4 flex items-center justify-between'>
            <div>
              <h2 id='mounts-title' class='text-lg font-semibold'>
                Media directories
              </h2>
              <p class='text-sm text-muted-foreground'>Runtime directories are always read only.</p>
            </div>
            <button
              type='button'
              class='rounded-md px-3 py-1.5 text-sm hover:bg-muted'
              onClick={props.onClose}
            >
              Close
            </button>
          </div>

          <div class='mb-5 space-y-2'>
            <input
              aria-label='Media directory name'
              placeholder='Name, e.g. Archive'
              class='h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm'
              value={name()}
              onInput={(event) => setName(event.currentTarget.value)}
            />
            <input
              aria-label='Media directory path'
              placeholder='Absolute path on the server'
              class='h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm'
              value={mountPath()}
              onInput={(event) => setMountPath(event.currentTarget.value)}
            />
            <div class='flex items-center gap-2'>
              <button
                type='button'
                class='inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50'
                disabled={!name().trim() || !mountPath().trim() || saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
              >
                <FolderPlus class='size-4' />
                {editing() ? 'Save directory' : 'Add directory'}
              </button>
              <Show when={editing()}>
                <button
                  type='button'
                  class='h-9 rounded-md px-3 text-sm hover:bg-muted'
                  onClick={() => {
                    setEditing(null)
                    setName('')
                    setMountPath('')
                  }}
                >
                  Cancel
                </button>
              </Show>
            </div>
            <Show when={saveMutation.isError}>
              <p class='text-sm text-destructive'>{saveMutation.error?.message}</p>
            </Show>
          </div>

          <div class='max-h-80 space-y-2 overflow-auto'>
            <Show when={mountsQuery.isLoading}>
              <p class='text-sm text-muted-foreground'>Loading…</p>
            </Show>
            <Show when={!mountsQuery.isLoading && (mountsQuery.data?.mounts.length ?? 0) === 0}>
              <p class='rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground'>
                No runtime media directories.
              </p>
            </Show>
            <For each={mountsQuery.data?.mounts ?? []}>
              {(mount) => (
                <div class='flex items-center gap-3 rounded-md border p-3'>
                  <div class='min-w-0 flex-1'>
                    <div class='flex items-center gap-2'>
                      <span class='font-medium'>{mount.name}</span>
                      <span class='rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground'>
                        Read only
                      </span>
                      <span
                        class={
                          mount.status === 'online'
                            ? 'text-xs text-emerald-600'
                            : 'text-xs text-destructive'
                        }
                      >
                        {mount.status}
                      </span>
                    </div>
                    <p class='truncate text-sm text-muted-foreground' title={mount.path}>
                      {mount.path}
                    </p>
                    <Show when={mount.shareCount > 0}>
                      <p class='text-xs text-muted-foreground'>
                        {mount.shareCount} active share{mount.shareCount === 1 ? '' : 's'}
                      </p>
                    </Show>
                  </div>
                  <button
                    type='button'
                    title='Edit media directory'
                    class='rounded-md p-2 hover:bg-muted'
                    onClick={() => {
                      setEditing(mount)
                      setName(mount.name)
                      setMountPath(mount.path)
                    }}
                  >
                    <Pencil class='size-4' />
                  </button>
                  <button
                    type='button'
                    title='Remove media directory'
                    class='rounded-md p-2 text-destructive hover:bg-muted'
                    onClick={() => {
                      const warning =
                        mount.shareCount > 0
                          ? ` ${mount.shareCount} share(s) will become unavailable.`
                          : ''
                      if (window.confirm(`Remove ${mount.name}?${warning}`))
                        deleteMutation.mutate(mount)
                    }}
                  >
                    <Trash class='size-4' />
                  </button>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </Show>
  )
}
