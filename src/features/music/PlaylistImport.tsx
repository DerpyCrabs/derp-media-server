import { Effect, Schema } from 'effect'
import { available, controllerView, list, modelOwner, resourceError, view } from 'effectweb'
import { observeQuery, query } from '@effectweb/query'
import { postSchemaEffect } from '@/lib/api/client'
import { groups, queryCache } from '@/lib/api/cache'
import { fetchDirectoryFilesEffect } from '@/lib/files/files-client'
import { fileNameFromPath, parentPath } from '@/lib/files/path-utils'
import type { FileItem } from '@/lib/files/types'
import {
  decodePlaylist,
  parsePlaylist,
  PLAYLIST_MAX_BYTES,
  type ParsedPlaylist,
} from './playlist-interchange'
const resultSchema = Schema.Struct({
  paths: Schema.Array(Schema.String),
  duplicates: Schema.Number,
  issues: Schema.Array(
    Schema.Struct({ index: Schema.Number, value: Schema.String, reason: Schema.String }),
  ),
})
const foldersQuery = query({
  name: 'playlist-import-folders',
  groups: [groups.files],
  load: (path: string) => fetchDirectoryFilesEffect(path),
})
type Props = {
  source?: { path: string; content: string }
  onSaved: (id: string) => void
  onBusy: (busy: boolean) => void
  onClose: () => void
}
function controller(props: Props) {
  const owner = modelOwner({
    props,
    parsed: null as ParsedPlaylist | null,
    filename: '',
    showFileInput: !props.source,
    name: '',
    base: props.source ? parentPath(props.source.path) : '',
    browsing: false,
    folders: [] as readonly FileItem[],
    folderError: '',
    folderLoading: false,
    preview: null as typeof resultSchema.Type | null,
    checking: false,
    saving: false,
    error: '',
    issueLimit: 50,
    matchLimit: 50,
    folderLimit: 100,
  })
  const folders = observeQuery(owner, queryCache, foldersQuery, (result) =>
    owner.patch({
      folders: available(result)?.files.filter((file) => file.isDirectory && !file.isVirtual) ?? [],
      folderError: resourceError(result),
      folderLoading: result.waiting,
    }),
  )
  function check() {
    const m = owner.read()
    if (!m.parsed || m.saving) return
    owner.patch({ checking: true, preview: null, error: '' })
    owner.run(
      'check',
      postSchemaEffect(resultSchema, '/api/music/playlists/resolve', {
        baseDirectory: m.base,
        entries: m.parsed.entries,
      }).pipe(
        Effect.tap((preview) => Effect.sync(() => owner.patch({ preview, checking: false }))),
        Effect.catch((error) =>
          Effect.sync(() => owner.patch({ checking: false, error: error.message })),
        ),
      ),
      'replace',
    )
  }
  function base(base: string) {
    owner.cancel('check')
    owner.patch({
      base,
      checking: false,
      preview: null,
      error: '',
      folderLimit: 100,
      matchLimit: 50,
    })
    if (owner.read().browsing) folders.select(base)
  }
  if (props.source) {
    owner.run(
      'initial',
      Effect.try({
        try: () =>
          parsePlaylist(
            props.source!.content,
            fileNameFromPath(props.source!.path),
            window.location.origin,
          ),
        catch: (error) =>
          error instanceof Error ? error : new Error('Could not read the playlist.'),
      }).pipe(
        Effect.tap((parsed) =>
          Effect.sync(() => {
            owner.patch({
              parsed,
              name: parsed.name,
              filename: fileNameFromPath(props.source!.path),
            })
            check()
          }),
        ),
        Effect.catch((error) => Effect.sync(() => owner.patch({ error: error.message }))),
      ),
      'drop',
    )
  }
  return {
    source: owner.source,
    check,
    base,
    chooseFile: () => owner.patch({ showFileInput: true }),
    name: (name: string) => owner.patch({ name }),
    browse: () => {
      const browsing = !owner.read().browsing
      owner.patch({ browsing })
      if (browsing) folders.select(owner.read().base)
    },
    more: () => owner.patch({ issueLimit: owner.read().issueLimit + 50 }),
    moreMatches: () => owner.patch({ matchLimit: owner.read().matchLimit + 50 }),
    moreFolders: () => owner.patch({ folderLimit: owner.read().folderLimit + 100 }),
    file: (file: File | undefined) => {
      if (!file || owner.read().saving) return
      owner.cancel('check')
      owner.patch({ filename: file.name, preview: null, parsed: null, checking: true, error: '' })
      owner.run(
        'file',
        Effect.gen(function* () {
          if (file.size > PLAYLIST_MAX_BYTES)
            return yield* Effect.fail(new Error('Playlist files must be smaller than 2 MiB.'))
          const bytes = yield* Effect.tryPromise(() => file.arrayBuffer())
          const parsed = yield* Effect.try({
            try: () =>
              parsePlaylist(
                decodePlaylist(new Uint8Array(bytes)),
                file.name,
                window.location.origin,
              ),
            catch: (error) =>
              error instanceof Error ? error : new Error('Could not read this playlist.'),
          })
          owner.patch({ parsed, name: parsed.name, checking: false })
          check()
          return undefined
        }).pipe(
          Effect.catch((error) =>
            Effect.sync(() =>
              owner.patch({
                checking: false,
                error: error instanceof Error ? error.message : 'Could not open the playlist file.',
              }),
            ),
          ),
        ),
        'replace',
      )
    },
    save: () => {
      const m = owner.read()
      if (!m.preview?.paths.length || !m.name.trim() || m.checking || m.saving) return
      owner.patch({ saving: true, error: '' })
      m.props.onBusy(true)
      owner.run(
        'save',
        postSchemaEffect(Schema.Struct({ id: Schema.String }), '/api/music/playlists', {
          name: m.name.trim(),
          paths: m.preview.paths,
        }).pipe(
          Effect.tap(({ id }) =>
            Effect.sync(() => {
              queryCache.invalidateGroup(groups.playlists)
              owner.patch({ saving: false })
              owner.read().props.onBusy(false)
              owner.read().props.onSaved(id)
            }),
          ),
          Effect.catch((error) =>
            Effect.sync(() => {
              owner.patch({ saving: false, error: error.message })
              owner.read().props.onBusy(false)
            }),
          ),
        ),
        'drop',
      )
    },
    receive: (next: Props) => owner.patch({ props: next }),
    lifetime: owner,
  }
}
const input = 'min-h-10 min-w-0 rounded-md border border-input bg-background px-2 text-sm'
const button =
  'min-h-10 rounded-md border border-input px-3 text-sm hover:bg-accent disabled:opacity-40'
export const PlaylistImport = controllerView(
  { controller },
  view((model) => {
    const { actions, props } = model
    return (
      <div class='space-y-4'>
        <p class='text-sm text-muted-foreground'>
          Import M3U, PLS or XSPF playlists. Music files stay in their current folders; review the
          matches before creating a playlist.
        </p>
        {model.showFileInput ? (
          <label class='block space-y-2 text-sm'>
            <span>Playlist file</span>
            <input
              type='file'
              accept='.m3u,.m3u8,.pls,.xspf'
              class='block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-foreground'
              disabled={model.saving}
              onChange={(event) => actions.file(event.currentTarget.files?.[0])}
            />
          </label>
        ) : (
          <div class='flex items-center gap-2 text-sm'>
            <span class='min-w-0 flex-1 truncate' title={props.source?.path}>
              {props.source?.path}
            </span>
            <button class={button} disabled={model.saving} onClick={actions.chooseFile}>
              Choose another file
            </button>
          </div>
        )}
        {model.parsed ? (
          <>
            <label class='block space-y-1 text-sm'>
              <span>Playlist name</span>
              <input
                class={`${input} w-full`}
                value={model.name}
                maxLength={160}
                disabled={model.saving}
                onInput={(event) => actions.name(event.currentTarget.value)}
              />
            </label>
            <div class='space-y-2'>
              <label class='block text-sm' for='playlist-base-folder'>
                Folder for relative paths
              </label>
              <div class='flex gap-2'>
                <input
                  id='playlist-base-folder'
                  class={`${input} flex-1`}
                  placeholder='Library root'
                  value={model.base}
                  disabled={model.saving}
                  onInput={(event) => actions.base(event.currentTarget.value)}
                />
                <button
                  class={button}
                  aria-expanded={model.browsing}
                  onClick={actions.browse}
                  disabled={model.saving}
                >
                  Browse
                </button>
              </div>
              <p class='text-xs text-muted-foreground'>
                Choose the folder the playlist was saved in. Absolute file paths must belong to this
                server’s library.
              </p>
              {model.browsing ? (
                <div
                  class='max-h-44 overflow-auto rounded-md border border-border p-1'
                  role='group'
                  aria-label='Playlist base folder'
                >
                  {model.base ? (
                    <button
                      class='block w-full rounded p-2 text-left text-sm hover:bg-accent'
                      disabled={model.saving}
                      onClick={() => actions.base(parentPath(model.base))}
                    >
                      ↑ Parent folder
                    </button>
                  ) : null}
                  {model.folderLoading ? (
                    <p class='p-2 text-xs text-muted-foreground'>Loading folders…</p>
                  ) : null}
                  {model.folderError ? (
                    <p role='alert' class='p-2 text-xs text-destructive'>
                      {model.folderError}
                    </p>
                  ) : null}
                  {list(
                    model.folders.slice(0, model.folderLimit),
                    (folder) => folder.path,
                    (folder) => (
                      <button
                        class='block w-full truncate rounded p-2 text-left text-sm hover:bg-accent'
                        disabled={model.saving}
                        onClick={() => actions.base(folder.path)}
                      >
                        {folder.name}
                      </button>
                    ),
                  )}
                  {model.folders.length > model.folderLimit ? (
                    <button class={button} onClick={actions.moreFolders}>
                      Show more folders
                    </button>
                  ) : null}
                  {!model.folderLoading && !model.folders.length ? (
                    <p class='p-2 text-xs text-muted-foreground'>No subfolders.</p>
                  ) : null}
                </div>
              ) : null}
              <button
                class={button}
                disabled={model.checking || model.saving}
                onClick={actions.check}
              >
                {model.checking ? 'Checking files…' : 'Check files'}
              </button>
            </div>
          </>
        ) : null}
        {model.preview ? (
          <div class='space-y-2 rounded-lg border border-border p-3'>
            <p role='status' class='text-sm'>
              {model.preview.paths.length} {model.preview.paths.length === 1 ? 'song' : 'songs'}{' '}
              found · {model.preview.issues.length} skipped
              {model.preview.duplicates
                ? ` · ${model.preview.duplicates} ${model.preview.duplicates === 1 ? 'duplicate' : 'duplicates'} removed`
                : ''}
            </p>
            {model.preview.paths.length ? (
              <p class='truncate text-xs text-muted-foreground' title={model.preview.paths[0]}>
                First song: {model.preview.paths[0]}
              </p>
            ) : null}
            {model.preview.paths.length ? (
              <details>
                <summary class='cursor-pointer text-xs'>Review matched songs</summary>
                <ol class='mt-2 max-h-40 list-inside list-decimal overflow-auto text-xs'>
                  {list(
                    model.preview.paths.slice(0, model.matchLimit),
                    (path) => path,
                    (path) => (
                      <li class='truncate py-1' title={path}>
                        {path}
                      </li>
                    ),
                  )}
                </ol>
                {model.preview.paths.length > model.matchLimit ? (
                  <button class={button} onClick={actions.moreMatches}>
                    Show more matched songs
                  </button>
                ) : null}
              </details>
            ) : null}
            {model.preview.issues.length ? (
              <details>
                <summary class='cursor-pointer text-xs'>Review skipped entries</summary>
                <ul class='mt-2 max-h-40 space-y-2 overflow-auto text-xs'>
                  {list(
                    model.preview.issues.slice(0, model.issueLimit),
                    (issue) => issue.index,
                    (issue) => (
                      <li>
                        <span class='block truncate' title={issue.value}>
                          {issue.value}
                        </span>
                        <span class='text-muted-foreground'>{issue.reason}</span>
                      </li>
                    ),
                  )}
                </ul>
                {model.preview.issues.length > model.issueLimit ? (
                  <button class={button} onClick={actions.more}>
                    Show more skipped entries
                  </button>
                ) : null}
              </details>
            ) : null}
          </div>
        ) : null}
        {model.error ? (
          <p role='alert' class='text-sm text-destructive'>
            {model.error}
          </p>
        ) : null}
        <div class='flex justify-end gap-2'>
          <button class={button} disabled={model.saving} onClick={props.onClose}>
            Cancel
          </button>
          <button
            class={`${button} bg-primary text-primary-foreground hover:bg-primary/90`}
            disabled={
              model.saving || model.checking || !model.preview?.paths.length || !model.name.trim()
            }
            onClick={actions.save}
          >
            {model.saving
              ? 'Importing…'
              : model.preview?.paths.length
                ? `Import ${model.preview.paths.length} ${model.preview.paths.length === 1 ? 'song' : 'songs'}`
                : 'Import playlist'}
          </button>
        </div>
      </div>
    )
  }),
)
