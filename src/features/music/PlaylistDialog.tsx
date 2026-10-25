import { controllerView, domBinding, list, Portal, view } from 'effectweb'
import X from '@effectweb/lucide/icons/x'
import ArrowLeft from '@effectweb/lucide/icons/arrow-left'
import { modalFocus } from '@/lib/ui/modal-focus'
import { playlistsController } from './playlists-controller'
import { TrackList } from './TrackList'
import { MusicArtwork } from './MusicArtwork'
const button = 'min-h-11 rounded-lg px-3 text-sm hover:bg-secondary disabled:opacity-40'
const primary = `${button} bg-primary text-primary-foreground hover:bg-primary/90`
const input = 'min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm'
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
      <Portal>
        <div
          class='fixed inset-0 z-[20000] flex items-center justify-center bg-black/55 p-3 sm:p-6'
          role='presentation'
          onPointerDown={(event) => {
            if (event.target === event.currentTarget && !form && !searchOpen) controller.close()
          }}
        >
          <div
            role='dialog'
            aria-modal='true'
            aria-label='Playlists'
            use={modalFocus({
              onEscape: () => {
                if (pending) return
                if (form) controller.cancelForm()
                else if (searchOpen) controller.closeSearch()
                else controller.close()
              },
            })}
            class='flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl'
          >
            <div class='flex shrink-0 items-center gap-2 border-b border-border px-4 py-3'>
              {model.id && !form && !searchOpen ? (
                <button
                  class={button}
                  aria-label='Back to playlists'
                  disabled={pending}
                  onClick={controller.back}
                >
                  <ArrowLeft size={18} />
                </button>
              ) : null}
              <h2 class='min-w-0 flex-1 truncate text-lg font-semibold'>
                {form
                  ? form.original
                    ? 'Edit playlist'
                    : 'New playlist'
                  : searchOpen
                    ? 'Add songs'
                    : (playlist?.name ?? (adding ? 'Add to playlist' : 'Playlists'))}
              </h2>
              <button
                class={button}
                aria-label='Close playlists'
                disabled={pending}
                onClick={controller.close}
              >
                <X size={20} />
              </button>
            </div>
            <div
              class='min-h-0 overflow-y-auto p-4 sm:p-5'
              use={{ ...domBinding(null, focusContent), identity: focusKey }}
            >
              {model.error ? (
                <div role='alert' class='mb-4 rounded-lg border border-destructive/40 p-3 text-sm'>
                  <p>{model.error}</p>
                  <button class={button} disabled={pending} onClick={controller.reload}>
                    Reload
                  </button>
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
                    <input
                      class={input}
                      autofocus
                      maxLength={160}
                      required
                      value={form.name}
                      disabled={pending}
                      onInput={(event) => controller.form({ name: event.currentTarget.value })}
                    />
                  </label>
                  {!form.original && !adding ? (
                    <label class='flex min-h-11 items-center gap-3 text-sm'>
                      <input
                        type='checkbox'
                        checked={form.smart}
                        disabled={pending}
                        onChange={(event) =>
                          controller.form({ smart: event.currentTarget.checked })
                        }
                      />
                      Choose songs automatically
                    </label>
                  ) : null}
                  {form.smart ? (
                    <fieldset
                      disabled={pending}
                      class='space-y-3 rounded-lg border border-border p-3'
                    >
                      <legend class='px-1 text-sm'>Match all conditions</legend>
                      <label class='block space-y-1 text-sm'>
                        <span>Genre</span>
                        <input
                          class={input}
                          value={form.rules.genre}
                          maxLength={100}
                          placeholder='Any genre'
                          onInput={(event) => controller.rule({ genre: event.currentTarget.value })}
                        />
                      </label>
                      <label class='block space-y-1 text-sm'>
                        <span>Artist contains</span>
                        <input
                          class={input}
                          value={form.rules.artist}
                          maxLength={300}
                          placeholder='Any artist'
                          onInput={(event) =>
                            controller.rule({ artist: event.currentTarget.value })
                          }
                        />
                      </label>
                      <label class='flex min-h-10 items-center gap-3 text-sm'>
                        <input
                          type='checkbox'
                          checked={form.rules.liked}
                          onChange={(event) =>
                            controller.rule({ liked: event.currentTarget.checked })
                          }
                        />
                        Liked songs
                      </label>
                      <label class='flex min-h-10 items-center gap-3 text-sm'>
                        <input
                          type='checkbox'
                          checked={form.rules.unplayed}
                          onChange={(event) =>
                            controller.rule({ unplayed: event.currentTarget.checked })
                          }
                        />
                        Never played
                      </label>
                      <div class='grid grid-cols-2 gap-3'>
                        <label class='space-y-1 text-sm'>
                          <span>Not played for days</span>
                          <input
                            class={input}
                            type='number'
                            min={0}
                            max={36500}
                            required
                            value={form.rules.notPlayedDays}
                            onInput={(event) =>
                              controller.rule({ notPlayedDays: event.currentTarget.valueAsNumber })
                            }
                          />
                        </label>
                        <label class='space-y-1 text-sm'>
                          <span>Maximum songs</span>
                          <input
                            class={input}
                            type='number'
                            min={1}
                            max={10000}
                            required
                            value={form.rules.limit}
                            onInput={(event) =>
                              controller.rule({ limit: event.currentTarget.valueAsNumber })
                            }
                          />
                        </label>
                      </div>
                      <p class='text-xs text-muted-foreground'>
                        Updates from your prepared music library as songs match these conditions.
                      </p>
                    </fieldset>
                  ) : adding && !form.original ? (
                    <p class='text-sm text-muted-foreground'>
                      {request.paths.length} songs will be saved in their queue order.
                    </p>
                  ) : null}
                  <div class='flex justify-end gap-2'>
                    <button
                      type='button'
                      class={button}
                      disabled={pending}
                      onClick={controller.cancelForm}
                    >
                      Cancel
                    </button>
                    <button class={primary} disabled={pending || !form.name.trim()}>
                      {pending ? 'Saving…' : 'Save playlist'}
                    </button>
                  </div>
                </form>
              ) : searchOpen ? (
                <div class='space-y-3'>
                  <input
                    class={input}
                    type='search'
                    autofocus
                    aria-label='Search songs'
                    placeholder='Title, artist, album or path'
                    value={model.query}
                    onInput={(event) => controller.query(event.currentTarget.value)}
                  />
                  <p role='status' class='text-xs text-muted-foreground'>
                    {model.searching
                      ? 'Searching…'
                      : `${model.total} songs · ${model.selected.length} selected`}
                  </p>
                  <div class='divide-y divide-border/50'>
                    {list(
                      model.searchItems,
                      (track) => track.path,
                      (track) => (
                        <label class='flex min-h-14 cursor-pointer items-center gap-3 py-2'>
                          <input
                            type='checkbox'
                            checked={model.selected.includes(track.path)}
                            disabled={
                              pending || playlist?.items.some((item) => item.path === track.path)
                            }
                            onChange={() => controller.toggle(track.path)}
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
                    <p class='py-4 text-sm text-muted-foreground'>
                      No matching songs. You can also save music from any folder using the player’s
                      queue.
                    </p>
                  ) : null}
                  {model.total > 100 ? (
                    <div class='flex items-center justify-between'>
                      <button
                        class={button}
                        disabled={model.searching || model.offset === 0}
                        onClick={() => controller.page(Math.max(0, model.offset - 100))}
                      >
                        Previous
                      </button>
                      <span class='text-xs'>
                        {model.offset + 1}–{Math.min(model.offset + 100, model.total)}
                      </span>
                      <button
                        class={button}
                        disabled={model.searching || model.offset + 100 >= model.total}
                        onClick={() => controller.page(model.offset + 100)}
                      >
                        Next
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : model.id ? (
                <>
                  {playlist ? (
                    <div class='space-y-3'>
                      <div class='flex flex-wrap items-center gap-2'>
                        <button
                          class={primary}
                          disabled={
                            busy || !playlist.items.some((track) => track.available !== false)
                          }
                          onClick={() => controller.play()}
                        >
                          Play all
                        </button>
                        {!playlist.rules ? (
                          <button class={button} disabled={busy} onClick={controller.search}>
                            Add songs
                          </button>
                        ) : null}
                        <button class={button} disabled={busy} onClick={controller.edit}>
                          Edit playlist
                        </button>
                        <button
                          class={`${button} ml-auto text-muted-foreground`}
                          disabled={busy}
                          onClick={() => controller.confirmDelete(true)}
                        >
                          Delete
                        </button>
                      </div>
                      <p class='text-xs text-muted-foreground'>
                        {playlist.items.length} songs{playlist.rules ? ' · Automatic playlist' : ''}
                      </p>
                      {model.confirmDelete ? (
                        <div role='alert' class='rounded-lg border border-border p-3 text-sm'>
                          <p>Delete “{playlist.name}”? Music files will be kept.</p>
                          <div class='mt-2 flex justify-end gap-2'>
                            <button
                              class={button}
                              disabled={pending}
                              onClick={() => controller.confirmDelete(false)}
                            >
                              Cancel
                            </button>
                            <button
                              class={`${button} text-destructive`}
                              disabled={pending}
                              onClick={controller.delete}
                            >
                              Delete playlist
                            </button>
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
                            : 'This playlist is empty. Add songs or save tracks here from their options menu.'}
                        </p>
                      )}
                      {playlist.items.length > model.limit ? (
                        <button class={button} onClick={controller.more}>
                          Show more songs ({playlist.items.length - model.limit} remaining)
                        </button>
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
                    <p class='text-sm text-muted-foreground'>
                      {adding
                        ? `${request.paths.length} songs selected`
                        : 'Saved songs, in your order'}
                    </p>
                    <button class={primary} disabled={pending} onClick={controller.create}>
                      New playlist
                    </button>
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
                        <button
                          class='flex min-h-18 w-full items-center gap-3 rounded-lg px-2 py-3 text-left hover:bg-secondary disabled:opacity-40'
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
                            <span class='mt-1 block text-xs text-muted-foreground'>
                              {item.count} songs{item.rules ? ' · Automatic' : ''}
                            </span>
                          </span>
                        </button>
                      ),
                    )}
                  </div>
                  {!model.listLoading && !model.items.some((item) => !adding || !item.rules) ? (
                    <p class='py-8 text-center text-sm text-muted-foreground'>
                      Create a playlist to keep songs together for another day.
                    </p>
                  ) : null}
                </div>
              )}
            </div>
            {searchOpen && !form ? (
              <div class='flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3'>
                <button class={button} disabled={pending} onClick={controller.closeSearch}>
                  Cancel
                </button>
                <button
                  class={primary}
                  disabled={pending || !model.selected.length}
                  onClick={controller.addSelected}
                >
                  {pending ? 'Adding…' : `Add ${model.selected.length || ''} songs`}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </Portal>
    )
  }),
)
