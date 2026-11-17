import { DropdownMenu } from '@/lib/ui/menu'
import Ellipsis from '@effectweb/lucide/icons/ellipsis'
import { Checkbox } from '@/lib/ui/checkbox'
import { Input } from '@/lib/ui/input'
import { Button } from '@/lib/ui/button'
import { controllerView, domBinding, list, view } from 'effectweb'
import ArrowLeft from '@effectweb/lucide/icons/arrow-left'
import { Dialog, DialogTitle } from '@/lib/ui/dialog'
import { playlistsController } from './playlists-controller'
import { TrackList } from './TrackList'
import { MusicArtwork } from './MusicArtwork'
const input = 'w-full'
function focusContent(element: HTMLDivElement) {
  let disposed = false
  queueMicrotask(() => {
    if (!disposed)
      (
        element.querySelector<HTMLElement>('[autofocus]') ??
        element.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled])')
      )?.focus()
  })
  return () => {
    disposed = true
  }
}
export const PlaylistDialog = controllerView(
  { controller: playlistsController, identity: (props) => JSON.stringify(props.request) },
  view((model) => {
    const controller = model.actions
    const { request, playlist, form, pending, loading, searchOpen } = model
    const busy = pending || loading
    const adding = request.paths.length > 0
    const focusKey = form ? 'form' : searchOpen ? 'search' : `${model.id}:${!!playlist}`
    return (
      <Dialog
        open
        aria-label='Playlists'
        onOpenChange={(open) => {
          if (open || pending) return
          if (form) controller.cancelForm()
          else if (searchOpen) controller.closeSearch()
          else controller.close()
        }}
        dismissible={!pending}
        class='sm:max-w-2xl max-h-[90dvh] flex flex-col'
      >
        <header class='flex min-w-0 items-center gap-2 pr-6'>
          {model.id && !form && !searchOpen ? (
            <Button
              size='icon-sm'
              variant='ghost'
              aria-label='Back to playlists'
              disabled={pending}
              onClick={controller.back}
            >
              <ArrowLeft size={16} />
            </Button>
          ) : null}
          <DialogTitle class='truncate'>
            {form
              ? form.original
                ? 'Rename playlist'
                : 'New playlist'
              : searchOpen
                ? 'Add songs'
                : (playlist?.name ?? (adding ? 'Add to playlist' : 'Playlists'))}
          </DialogTitle>
        </header>
        <div
          class='min-h-0 overflow-y-auto'
          use={domBinding(null, focusContent, { identity: focusKey })}
        >
          {model.error ? (
            <div role='alert' class='mb-4 rounded-lg border border-destructive/40 p-3 text-sm'>
              <p>{model.error}</p>
              <Button variant='ghost' disabled={pending} onClick={controller.reload}>
                Reload
              </Button>
            </div>
          ) : null}
          {form ? (
            <form
              class='space-y-4'
              onSubmit={(event) => {
                event.preventDefault()
                controller.save()
              }}
            >
              <label class='block space-y-2 text-sm'>
                <span>Name</span>
                <Input
                  class={input}
                  autofocus
                  maxLength={160}
                  required
                  value={form.name}
                  disabled={pending}
                  onInput={(event) => controller.form({ name: event.currentTarget.value })}
                />
              </label>
              <div class='flex justify-end gap-2'>
                <Button
                  variant='ghost'
                  type='button'

                  disabled={pending}
                  onClick={controller.cancelForm}
                >
                  Cancel
                </Button>
                <Button variant='default' type='submit' disabled={pending || !form.name.trim()}>
                  {pending ? 'Saving…' : 'Save playlist'}
                </Button>
              </div>
            </form>
          ) : searchOpen ? (
            <div class='space-y-3'>
              <Input
                class={input}
                type='search'
                autofocus
                aria-label='Search songs'
                placeholder='Title, artist, album or path'
                value={model.query}
                onInput={(event) => controller.query(event.currentTarget.value)}
              />
              {model.searching ? (
                <p role='status' class='text-xs text-muted-foreground'>
                  Searching…
                </p>
              ) : null}
              <div class='divide-y divide-border/50'>
                {list(
                  model.searchItems,
                  (track) => track.path,
                  (track) => (
                    <label class='flex min-h-14 cursor-pointer items-center gap-3 py-2'>
                      <Checkbox
                        checked={model.selected.includes(track.path)}
                        disabled={
                          pending || playlist?.items.some((item) => item.path === track.path)
                        }
                        onCheckedChange={() => controller.toggle(track.path)}
                      />
                      <span class='min-w-0 flex-1'>
                        <span class='block truncate text-sm'>{track.title}</span>
                        <span class='block truncate text-xs text-muted-foreground'>
                          {track.artist || track.path}
                        </span>
                      </span>
                      {playlist?.items.some((item) => item.path === track.path) ? (
                        <span class='text-xs text-muted-foreground'>Added</span>
                      ) : null}
                    </label>
                  ),
                )}
              </div>
              {!model.searchItems.length && !model.searching ? (
                <p class='py-4 text-sm text-muted-foreground'>No matching songs.</p>
              ) : null}
              {model.total > 100 ? (
                <div class='flex items-center justify-between'>
                  <Button
                    variant='ghost'

                    disabled={model.searching || model.offset === 0}
                    onClick={() => controller.page(Math.max(0, model.offset - 100))}
                  >
                    Previous
                  </Button>
                  <span class='text-xs'>
                    {model.offset + 1}–{Math.min(model.offset + 100, model.total)}
                  </span>
                  <Button
                    variant='ghost'

                    disabled={model.searching || model.offset + 100 >= model.total}
                    onClick={() => controller.page(model.offset + 100)}
                  >
                    Next
                  </Button>
                </div>
              ) : null}
            </div>
          ) : model.id ? (
            <>
              {playlist ? (
                <div class='space-y-3'>
                  <div class='flex flex-wrap items-center gap-2'>
                    <Button
                      variant='default'
                      disabled={busy || !playlist.items.some((track) => track.available !== false)}
                      onClick={() => controller.play()}
                    >
                      Play all
                    </Button>
                    {!playlist.rules ? (
                      <Button
                        variant='ghost'

                        disabled={busy}
                        onClick={controller.search}
                      >
                        Add songs
                      </Button>
                    ) : null}
                    <DropdownMenu
                      align='end'
                      trigger={
                        <Button
                          variant='ghost'
                          size='icon'
                          class='ml-auto'
                          aria-label='Playlist options'
                          disabled={busy}
                        >
                          <Ellipsis />
                        </Button>
                      }
                      items={[
                        { kind: 'item', label: 'Edit playlist', onSelect: controller.edit },
                        {
                          kind: 'item',
                          label: 'Delete playlist',
                          variant: 'destructive',
                          onSelect: () => controller.confirmDelete(true),
                        },
                      ]}
                    />
                  </div>
                  {playlist.rules ? (
                    <p class='text-xs text-muted-foreground'>Automatic playlist</p>
                  ) : null}
                  {model.confirmDelete ? (
                    <div role='alert' class='rounded-lg border border-border p-3 text-sm'>
                      <p>Delete “{playlist.name}”? Music files will be kept.</p>
                      <div class='mt-2 flex justify-end gap-2'>
                        <Button
                          variant='ghost'

                          disabled={pending}
                          onClick={() => controller.confirmDelete(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant='ghost'
                          class='text-destructive'
                          disabled={pending}
                          onClick={controller.delete}
                        >
                          Delete playlist
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  {playlist.items.length ? (
                    <TrackList
                      limit={model.limit}
                      items={playlist.items}
                      title={playlist.name}
                      onPlay={controller.play}
                      disabled={busy}
                      onRemove={playlist.rules ? undefined : controller.remove}
                      onMove={playlist.rules ? undefined : controller.move}
                    />
                  ) : (
                    <p class='py-8 text-center text-sm text-muted-foreground'>
                      {playlist.rules
                        ? 'No songs match these conditions yet.'
                        : 'This playlist is empty.'}
                    </p>
                  )}
                  {playlist.items.length > model.limit ? (
                    <Button variant='ghost' onClick={controller.more}>
                      Show more songs
                    </Button>
                  ) : null}
                </div>
              ) : loading ? (
                <p role='status' class='py-8 text-sm text-muted-foreground'>
                  Loading playlist…
                </p>
              ) : null}
            </>
          ) : (
            <div class='space-y-3'>
              <div class='flex items-center justify-between gap-3'>
                <Button variant='default' disabled={pending} onClick={controller.create}>
                  New playlist
                </Button>
              </div>
              {model.listLoading && !model.items.length ? (
                <p role='status' class='py-8 text-sm text-muted-foreground'>
                  Loading playlists…
                </p>
              ) : null}
              <div class='divide-y divide-border/50'>
                {list(
                  model.items.filter((item) => !adding || !item.rules),
                  (item) => item.id,
                  (item) => (
                    <Button
                      variant='ghost'
                      class='flex min-h-18 w-full items-center gap-3 rounded-lg px-2 py-3 justify-start text-left hover:bg-secondary disabled:opacity-40'
                      disabled={pending}
                      onClick={() =>
                        adding ? controller.addTo(item.id) : controller.select(item.id)
                      }
                    >
                      <MusicArtwork
                        path={item.preview?.path}
                        hasArtwork={item.preview?.hasArtwork}
                      />
                      <span class='min-w-0 flex-1'>
                        <span class='block truncate text-sm font-medium'>{item.name}</span>
                        {item.rules ? (
                          <span class='mt-1 block text-xs text-muted-foreground'>Automatic</span>
                        ) : null}
                      </span>
                    </Button>
                  ),
                )}
              </div>
              {!model.listLoading && !model.items.some((item) => !adding || !item.rules) ? (
                <p class='py-8 text-center text-sm text-muted-foreground'>No playlists yet.</p>
              ) : null}
            </div>
          )}
        </div>
        {searchOpen && !form ? (
          <div class='flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3'>
            <Button
              variant='ghost'

              disabled={pending}
              onClick={controller.closeSearch}
            >
              Cancel
            </Button>
            <Button
              variant='default'
              disabled={pending || !model.selected.length}
              onClick={controller.addSelected}
            >
              {pending ? 'Adding…' : `Add ${model.selected.length || ''} songs`}
            </Button>
          </div>
        ) : null}
      </Dialog>
    )
  }),
)
