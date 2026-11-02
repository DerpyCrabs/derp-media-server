import { Effect, Schema } from 'effect'
import { available, modelOwner } from 'effectweb'
import { observeQuery } from '@effectweb/query'
import { groups, queryCache } from '@/lib/api/cache'
import { apiSchemaEffect, postSchemaEffect } from '@/lib/api/client'
import { playlistQuery, playlistsQuery, musicSearchQuery } from './queries'
import type { MusicTrack, Playlist, PlaylistRules, PlaylistSummary } from './types'
import { closePlaylists, notifyMusic, playMusic, type PlaylistRequest } from './actions'
import { getPlaybackSession } from '@/features/playback/PlaybackProvider'
const ok = Schema.Struct({ ok: Schema.Boolean })
const emptyRules = (): PlaylistRules => ({
  genre: '',
  artist: '',
  liked: false,
  unplayed: false,
  notPlayedDays: 0,
  limit: 1000,
})
export type PlaylistForm = {
  name: string
  smart: boolean
  rules: PlaylistRules
  original: Playlist | null
}
export function playlistsController(props: { request: PlaylistRequest }) {
  const owner = modelOwner({
    request: props.request,
    items: [] as readonly PlaylistSummary[],
    listLoading: true,
    playlist: null as Playlist | null,
    id: '',
    loading: false,
    pending: false,
    error: '',
    form: null as PlaylistForm | null,
    confirmDelete: false,
    searchOpen: false,
    query: '',
    offset: 0,
    searchItems: [] as readonly MusicTrack[],
    total: 0,
    searching: false,
    selected: [] as string[],
    limit: 100,
  })
  const list = observeQuery(owner, queryCache, playlistsQuery, (result) => {
    owner.patch({
      items: available(result)?.items ?? [],
      listLoading: result.waiting,
      ...(result._tag === 'Failure' ? { error: 'Could not load playlists. Try again.' } : {}),
    })
  })
  const detail = observeQuery(owner, queryCache, playlistQuery, (result) => {
    owner.patch({
      playlist: available(result) ?? null,
      loading: result.waiting,
      ...(result._tag === 'Failure'
        ? { error: 'Could not load this playlist. It may have been deleted.' }
        : {}),
    })
  })
  const search = observeQuery(owner, queryCache, musicSearchQuery, (result) => {
    owner.patch({
      searchItems: available(result)?.items ?? [],
      total: available(result)?.total ?? 0,
      searching: result.waiting,
      ...(result._tag === 'Failure' ? { error: 'Could not search music. Try again.' } : {}),
    })
  })
  list.select(true)
  function select(id: string) {
    owner.patch({
      id,
      limit: 100,
      playlist: null,
      error: '',
      loading: true,
      form: null,
      confirmDelete: false,
      searchOpen: false,
    })
    detail.select(id)
  }
  function back() {
    detail.select(undefined)
    owner.patch({
      id: '',
      playlist: null,
      form: null,
      searchOpen: false,
      confirmDelete: false,
      error: '',
      loading: false,
    })
  }
  function run<A, E extends { message: string }>(
    effect: Effect.Effect<A, E>,
    done: (value: A) => void,
  ) {
    if (owner.read().pending) return
    owner.patch({ pending: true, error: '' })
    owner.run(
      'mutation',
      effect.pipe(
        Effect.tap((value) =>
          Effect.sync(() => {
            queryCache.invalidateGroup(groups.playlists)
            owner.patch({ pending: false })
            done(value)
          }),
        ),
        Effect.catch((error) =>
          Effect.sync(() => owner.patch({ pending: false, error: error.message })),
        ),
      ),
      'drop',
    )
  }
  function update(
    playlist: Playlist,
    paths: readonly string[],
    name = playlist.name,
    rules = playlist.rules,
  ) {
    return apiSchemaEffect(ok, `/api/music/playlists/${encodeURIComponent(playlist.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ name, rules, paths, expectedUpdatedAt: playlist.updatedAt }),
    })
  }
  function append(id: string, paths: readonly string[], done: () => void) {
    run(
      postSchemaEffect(ok, `/api/music/playlists/${encodeURIComponent(id)}/tracks`, { paths }),
      done,
    )
  }
  function searchAt(q: string, offset: number) {
    owner.patch({ query: q, offset, searching: true, error: '' })
    search.select({ q, offset })
  }
  return {
    source: owner.source,
    lifetime: owner,
    more: () => owner.patch({ limit: owner.read().limit + 100 }),
    close: () => {
      if (!owner.read().pending) closePlaylists()
    },
    select,
    back,
    reload: () => {
      owner.patch({ error: '', form: null })
      list.refresh()
      if (owner.read().id) detail.refresh()
      if (owner.read().searchOpen) search.refresh()
    },
    create: () =>
      owner.patch({
        form: {
          name: owner.read().request.name,
          smart: false,
          rules: emptyRules(),
          original: null,
        },
        error: '',
      }),
    edit: () => {
      const playlist = owner.read().playlist
      if (playlist)
        owner.patch({
          form: {
            name: playlist.name,
            smart: !!playlist.rules,
            rules: playlist.rules ?? emptyRules(),
            original: playlist,
          },
          error: '',
        })
    },
    form: (change: Partial<PlaylistForm>) => {
      const form = owner.read().form
      if (form) owner.patch({ form: { ...form, ...change } })
    },
    rule: (change: Partial<PlaylistRules>) => {
      const form = owner.read().form
      if (form) owner.patch({ form: { ...form, rules: { ...form.rules, ...change } } })
    },
    cancelForm: () => owner.patch({ form: null, error: '' }),
    save: () => {
      const { form, request } = owner.read()
      if (!form || !form.name.trim()) return
      const rules = form.smart ? form.rules : null
      if (form.original) {
        run(
          update(
            form.original,
            form.original.items.map((track) => track.path),
            form.name,
            rules,
          ),
          () => owner.patch({ form: null }),
        )
      } else {
        run(
          postSchemaEffect(Schema.Struct({ id: Schema.String }), '/api/music/playlists', {
            name: form.name,
            rules,
            paths: request.paths,
          }),
          ({ id }) => {
            if (request.paths.length) {
              notifyMusic('Playlist saved')
              closePlaylists()
            } else select(id)
          },
        )
      }
    },
    addTo: (id: string) =>
      append(id, owner.read().request.paths, () => {
        notifyMusic('Added to playlist')
        closePlaylists()
      }),
    play: (index = 0) => {
      const playlist = owner.read().playlist
      if (!playlist) return
      const chosen = playlist.items[index]
      const tracks = playlist.items.filter((track) => track.available !== false)
      const start = Math.max(
        0,
        tracks.findIndex((track) => track.path === chosen?.path),
      )
      playMusic(
        getPlaybackSession(),
        tracks,
        { kind: 'playlist', id: playlist.id, title: playlist.name },
        start,
      )
      owner.run(
        'played',
        postSchemaEffect(
          ok,
          `/api/music/playlists/${encodeURIComponent(playlist.id)}/played`,
          {},
        ).pipe(
          Effect.tap(() => Effect.sync(() => queryCache.invalidateGroup(groups.playlists))),
          Effect.ignore,
        ),
        'replace',
      )
    },
    remove: (path: string) => {
      const playlist = owner.read().playlist
      if (playlist && !playlist.rules)
        run(
          update(
            playlist,
            playlist.items.filter((track) => track.path !== path).map((track) => track.path),
          ),
          () => {},
        )
    },
    move: (path: string, delta: number) => {
      const playlist = owner.read().playlist
      if (!playlist || playlist.rules) return
      const paths = playlist.items.map((track) => track.path)
      const index = paths.indexOf(path),
        target = index + delta
      if (index < 0 || target < 0 || target >= paths.length) return
      paths.splice(target, 0, ...paths.splice(index, 1))
      run(update(playlist, paths), () => {})
    },
    confirmDelete: (confirmDelete: boolean) => owner.patch({ confirmDelete }),
    delete: () => {
      const { id, confirmDelete } = owner.read()
      if (!id || !confirmDelete) return
      run(
        apiSchemaEffect(ok, `/api/music/playlists/${encodeURIComponent(id)}`, { method: 'DELETE' }),
        () => {
          back()
          notifyMusic('Playlist deleted; music files were kept')
        },
      )
    },
    search: () => {
      owner.patch({ searchOpen: true, selected: [] })
      searchAt('', 0)
    },
    closeSearch: () => owner.patch({ searchOpen: false, selected: [], error: '' }),
    query: (query: string) => {
      owner.patch({ query })
      owner.run(
        'search-delay',
        Effect.sleep(200).pipe(Effect.andThen(Effect.sync(() => searchAt(query, 0)))),
        'replace',
      )
    },
    page: (offset: number) => searchAt(owner.read().query, offset),
    toggle: (path: string) => {
      const selected = owner.read().selected
      owner.patch({
        selected: selected.includes(path)
          ? selected.filter((p) => p !== path)
          : [...selected, path],
      })
    },
    addSelected: () => {
      const { id, selected } = owner.read()
      if (id && selected.length)
        append(id, selected, () => owner.patch({ searchOpen: false, selected: [] }))
    },
  }
}
