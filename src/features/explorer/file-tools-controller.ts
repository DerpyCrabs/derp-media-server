import { archiveEntrySchema as entrySchema, archiveQuery } from './archive-contents'
import { Effect, Schema } from 'effect'
import { available, modelOwner } from 'effectweb'
import { query, observeQuery } from '@effectweb/query'
import { apiSchemaEffect, postSchemaEffect } from '@/lib/api/client'
import { groups, queryCache } from '@/lib/api/cache'
import { directoryFilesSchema } from '@/lib/files/file-schemas'
import { isPathEditable } from '@/lib/files/path-utils'
import type { FileItem } from '@/lib/files/types'
import type { FileBrowserHost } from './FileBrowser'
import { fileJobs, type FileOperation } from './file-jobs'
import { selectFiles } from './file-selection'
import { browserPreferences } from './browser-preferences'
import { configQuery, settingsQuery } from '@/lib/api/queries'
import { runDesktopOperation } from '@/desktop/operations'

const favoritePlacesQuery = query({
  name: 'favorite-places',
  groups: [groups.files, groups.settings],
  load: () => apiSchemaEffect(directoryFilesSchema, '/api/files?dir=Favorites'),
})
const placesQuery = query({
  name: 'desktop-places',
  groups: [groups.config],
  load: () =>
    apiSchemaEffect(
      Schema.Struct({
        places: Schema.Array(
          Schema.Struct({ name: Schema.String, path: Schema.String, kind: Schema.String }),
        ),
      }),
      '/api/desktop/places',
    ),
})
const trashEntrySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  path: Schema.String,
  deletedAt: Schema.Number,
  directory: Schema.Boolean,
  editable: Schema.Boolean,
})
const trashQuery = query({
  name: 'desktop-trash',
  groups: [groups.files],
  load: () =>
    apiSchemaEffect(
      Schema.Struct({ entries: Schema.Array(trashEntrySchema) }),
      '/api/desktop/trash',
    ),
})
const hiddenQuery = query({
  name: 'hidden-directory',
  groups: [groups.files],
  load: (path: string) =>
    apiSchemaEffect(directoryFilesSchema, `/api/files/hidden?dir=${encodeURIComponent(path)}`),
})
const propertiesQuery = query({
  name: 'file-properties',
  groups: [groups.files],
  load: (path: string) =>
    apiSchemaEffect(
      Schema.Struct({
        path: Schema.String,
        size: Schema.Number,
        directory: Schema.Boolean,
        permissions: Schema.String,
        editable: Schema.Boolean,
        modified: Schema.NullOr(Schema.Number),
      }),
      `/api/files/properties?path=${encodeURIComponent(path)}`,
    ),
})
type Panel =
  | 'menu'
  | 'location'
  | 'properties'
  | 'archive'
  | 'createArchive'
  | 'operations'
  | 'delete'
  | 'trash'
  | 'copy'
  | 'move'
  | 'extractArchive'
  | null
export function createFileTools(host: () => FileBrowserHost, files: () => readonly FileItem[]) {
  const owner = modelOwner({
    desktop: !!window.derpDesktop,
    desktopMode: false,
    trashAvailable: false,
    permanentDelete: false,
    trashEntries: undefined as readonly (typeof trashEntrySchema.Type)[] | undefined,
    trashLoading: false,
    trashNotice: '',
    selected: [] as string[],
    anchor: null as string | null,
    previewPath: null as string | null,
    selecting: false,
    hidden: browserPreferences.read().showHidden,
    hiddenFiles: undefined as readonly FileItem[] | undefined,
    applyAll: false,
    filter: '',
    folderFilter: '',
    filterOpen: false,
    panel: null as Panel,
    path: host().currentPath,
    name: 'Archive.zip',
    error: '',
    pending: false,
    archive: undefined as readonly (typeof entrySchema.Type)[] | undefined,
    members: [] as string[],
    properties: undefined as
      | {
          path: string
          size: number
          directory: boolean
          permissions: string
          editable: boolean
          modified: number | null
        }
      | undefined,
    jobs: fileJobs.read(),
    favoritePlaces: [] as readonly { name: string; path: string; kind: string }[],
    places: [] as readonly { name: string; path: string; kind?: string }[],
    applications: [] as { id: string; name: string }[],
  })
  const hidden = observeQuery(owner, queryCache, hiddenQuery, (result) => {
    owner.patch({ hiddenFiles: available(result)?.files })
    if (result._tag === 'Failure') owner.patch({ error: 'Could not load hidden files.' })
  })
  hidden.select(owner.read().hidden ? host().currentPath : undefined)
  owner.own(
    browserPreferences.source.subscribe((preferences) => {
      owner.patch({ hidden: preferences.showHidden, hiddenFiles: undefined })
      hidden.select(preferences.showHidden ? host().currentPath : undefined)
    }),
  )
  const favoritePlaces = observeQuery(owner, queryCache, favoritePlacesQuery, (result) => {
    owner.patch({
      favoritePlaces: (available(result)?.files ?? [])
        .filter((file) => file.isDirectory && !file.isVirtual)
        .map((file) => ({ name: file.name, path: file.path, kind: 'favorite' })),
    })
  })
  const settings = observeQuery(owner, queryCache, settingsQuery, (result) => {
    favoritePlaces.select(available(result)?.favorites.length ? true : undefined)
  })
  settings.select(true)
  const places = observeQuery(owner, queryCache, placesQuery, (result) => {
    owner.patch({ places: available(result)?.places ?? [] })
  })
  const config = observeQuery(owner, queryCache, configQuery, (result) => {
    const desktopMode = available(result)?.desktopMode ?? false
    owner.patch({ desktopMode, trashAvailable: available(result)?.trashAvailable ?? false })
    places.select(desktopMode ? true : undefined)
  })
  config.select(true)
  const trash = observeQuery(owner, queryCache, trashQuery, (result) => {
    owner.patch({ trashEntries: available(result)?.entries, trashLoading: result.waiting })
    if (result._tag === 'Failure')
      owner.patch({ error: 'Could not load the system trash. Try refreshing.' })
  })
  const archive = observeQuery(owner, queryCache, archiveQuery, (result) => {
    owner.patch({ archive: available(result)?.entries, pending: result.waiting })
    if (result._tag === 'Failure')
      owner.patch({
        error:
          'Could not read this archive. It may be damaged, encrypted, or contain unsafe paths.',
      })
  })
  const properties = observeQuery(owner, queryCache, propertiesQuery, (result) => {
    owner.patch({ properties: available(result) })
    if (result._tag === 'Failure') owner.patch({ error: 'Could not load file properties.' })
  })
  owner.own(fileJobs.source.subscribe((jobs) => owner.patch({ jobs })))
  const selected = () =>
    owner.read().selected.filter((path) => files().some((f) => f.path === path && !f.isVirtual))
  const clear = () => owner.patch({ selected: [], anchor: null, selecting: false })
  const open = (panel: Panel) => {
    owner.patch({
      panel,
      path: host().currentPath,
      error: '',
      permanentDelete: false,
      trashNotice: '',
    })
    trash.select(panel === 'trash' && owner.read().trashAvailable ? true : undefined)
    if (panel === 'trash') trash.refresh()
    if (panel === 'operations') fileJobs.refresh()
    if (panel === 'properties' && selected()[0]) properties.select(selected()[0])
    if (panel === 'archive' && selected()[0]) {
      owner.patch({ members: [], archive: undefined })
      archive.select(selected()[0])
    }
  }
  const start = (operation: FileOperation, destination = owner.read().path) => {
    fileJobs.start({
      operation,
      paths: selected(),
      destination,
      name: owner.read().name,
      entries:
        operation === 'extractArchive' && owner.read().members.length
          ? owner.read().members
          : undefined,
    })
    open('operations')
  }
  const copy = (cut: boolean) => {
    const paths = selected()
    if (
      !paths.length ||
      (cut &&
        paths.some((path) => !isPathEditable(path, host().editableFolders, host().mediaRoots)))
    )
      return
    fileJobs.copy(paths, cut)
    if (window.derpDesktop)
      runDesktopOperation(() =>
        cut && window.derpDesktop!.cut
          ? window.derpDesktop!.cut(paths)
          : window.derpDesktop!.copy(paths),
      )
  }
  const paste = () => {
    if (!isPathEditable(host().currentPath, host().editableFolders, host().mediaRoots)) return
    if (window.derpDesktop) {
      runDesktopOperation(async () => {
        await window.derpDesktop!.paste(host().currentPath)
        fileJobs.refresh()
      })
      open('operations')
      return
    }
    const clipboard = fileJobs.read().clipboard
    if (clipboard) {
      fileJobs.start({
        operation: clipboard.cut ? 'move' : 'copy',
        paths: clipboard.paths,
        destination: host().currentPath,
      })
      open('operations')
      if (clipboard.cut) fileJobs.clearClipboard()
    }
  }
  const navigate = () => {
    const path = owner.read().path.trim()
    owner.patch({ pending: true, error: '' })
    owner.run(
      'navigate',
      (owner.read().desktopMode && (path.startsWith('/') || path === '~' || path.startsWith('~/'))
        ? apiSchemaEffect(
            Schema.Struct({ path: Schema.String, isDirectory: Schema.Boolean }),
            '/api/desktop/resolve',
            { method: 'POST', body: JSON.stringify({ path, absolute: true }) },
          ).pipe(
            Effect.flatMap((result) =>
              result.isDirectory
                ? Effect.succeed(result.path)
                : Effect.fail(new Error('Choose a folder, not a file.')),
            ),
          )
        : window.derpDesktop?.resolvePath && path.startsWith('/')
          ? Effect.tryPromise({
              try: () => window.derpDesktop!.resolvePath!(path),
              catch: (error) => (error instanceof Error ? error : new Error(String(error))),
            })
          : apiSchemaEffect(
              directoryFilesSchema,
              `/api/files?dir=${encodeURIComponent(path === '/' ? '' : path)}`,
            ).pipe(Effect.as(path === '/' ? '' : path))
      ).pipe(
        Effect.tap((path) =>
          Effect.sync(() => {
            owner.patch({ panel: null, pending: false })
            host().navigate(path)
          }),
        ),
        Effect.catch((error) =>
          Effect.sync(() => owner.patch({ error: error.message, pending: false })),
        ),
      ),
      'replace',
    )
  }
  return {
    source: owner.source,
    read: owner.read,
    dispose: owner.dispose,
    open,
    clear,
    preview: (path: string | null) => owner.patch({ previewPath: path, panel: null }),
    start,
    refreshTrash: () => {
      owner.patch({ error: '' })
      trash.refresh()
    },
    restoreTrash: (id: string) => {
      if (owner.read().pending) return
      owner.patch({ pending: true, error: '', trashNotice: '' })
      owner.run(
        'restore-trash',
        postSchemaEffect(Schema.Struct({ path: Schema.String }), '/api/desktop/trash/restore', {
          id,
        }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              owner.patch({ pending: false, trashNotice: `Restored ${result.path}` })
              trash.refresh()
            }),
          ),
          Effect.catch((error) =>
            Effect.sync(() => owner.patch({ pending: false, error: error.message })),
          ),
        ),
        'replace',
      )
    },
    copy,
    paste,
    navigate,
    refreshPlaces: () => {
      if (owner.read().favoritePlaces.length) favoritePlaces.refresh()
      if (owner.read().desktopMode) places.refresh()
      else if (window.derpDesktop?.places) {
        owner.run(
          'native-places',
          Effect.tryPromise({
            try: () => window.derpDesktop!.places!(),
            catch: (error) => (error instanceof Error ? error : new Error(String(error))),
          }).pipe(
            Effect.tap((places) => Effect.sync(() => owner.patch({ places }))),
            Effect.catch((error) => Effect.sync(() => owner.patch({ error: error.message }))),
          ),
          'replace',
        )
      }
    },
    openFilter: () => owner.patch({ filterOpen: true, panel: null }),
    patch: owner.patch,
    toggleHidden: browserPreferences.toggleHidden,
    moveFocus: (
      from: FileItem,
      to: FileItem,
      event: KeyboardEvent,
      ordered: readonly FileItem[],
    ) => {
      const state = owner.read()
      if (event.shiftKey) {
        owner.patch({
          selecting: true,
          ...selectFiles(
            state.selected,
            state.anchor ?? from.path,
            to,
            ordered,
            { shiftKey: true },
            false,
          ),
        })
      } else if (state.selected.length) {
        owner.patch({
          selected: to.isVirtual ? [] : [to.path],
          anchor: to.isVirtual ? null : to.path,
        })
      }
    },
    selectMode: () => {
      if (owner.read().selecting) clear()
      else owner.patch({ selecting: true })
    },
    selectAll: () =>
      owner.patch({
        selecting: true,
        selected: files()
          .filter((f) => !f.isVirtual)
          .map((f) => f.path),
      }),
    click(
      file: FileItem,
      event: MouseEvent | KeyboardEvent | undefined,
      ordered: readonly FileItem[],
    ) {
      const state = owner.read()
      if (
        !state.selecting &&
        !state.selected.length &&
        !event?.ctrlKey &&
        !event?.metaKey &&
        !event?.shiftKey
      )
        return false
      owner.patch(
        selectFiles(state.selected, state.anchor, file, ordered, event ?? {}, state.selecting),
      )
      return true
    },
    keyDown(
      event: KeyboardEvent,
      ordered: readonly FileItem[],
      actions?: { rename: (file: FileItem) => void; createFolder: () => void; refresh: () => void },
    ) {
      if (
        event.defaultPrevented ||
        host().selection ||
        host().active === false ||
        document.querySelector(
          '[role=dialog], [role=alertdialog], [data-floating-surface][role=menu]',
        )
      )
        return
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('input, textarea, [contenteditable=true]')
      )
        return
      const key = event.key.toLowerCase(),
        control = event.ctrlKey || event.metaKey
      const focusedPath =
        event.target instanceof Element
          ? event.target.closest('[data-file-path]')?.getAttribute('data-file-path')
          : null
      if (
        focusedPath &&
        !selected().length &&
        ((control && ['c', 'x'].includes(key)) ||
          key === 'delete' ||
          (event.altKey && key === 'enter'))
      ) {
        const file = ordered.find((file) => file.path === focusedPath)
        if (file && !file.isVirtual) owner.patch({ selected: [file.path], anchor: file.path })
      }
      if (
        key === ' ' &&
        !control &&
        !event.altKey &&
        !event.shiftKey &&
        !(event.target instanceof Element && event.target.closest('button, a'))
      ) {
        const path = focusedPath ?? selected()[0]
        const file = ordered.find((file) => file.path === path)
        if (file && !file.isDirectory && !file.isVirtual) {
          event.preventDefault()
          owner.patch({ previewPath: file.path })
        }
      } else if (control && key === 'f') {
        event.preventDefault()
        owner.patch({ filterOpen: true })
      } else if (event.altKey && key === 'arrowup') {
        event.preventDefault()
        host().navigate(host().currentPath.split('/').slice(0, -1).join('/'))
      } else if (key === 'f5' && actions) {
        event.preventDefault()
        actions.refresh()
        if (owner.read().hidden) hidden.refresh()
      } else if (
        control &&
        event.shiftKey &&
        key === 'n' &&
        actions &&
        isPathEditable(host().currentPath, host().editableFolders, host().mediaRoots)
      ) {
        event.preventDefault()
        actions.createFolder()
      } else if (key === 'f2' && actions) {
        const file = ordered.find(
          (file) => file.path === (focusedPath ?? (selected().length === 1 ? selected()[0] : null)),
        )
        if (
          file &&
          !file.isVirtual &&
          isPathEditable(file.path, host().editableFolders, host().mediaRoots)
        ) {
          event.preventDefault()
          actions.rename(file)
        }
      } else if ((control && key === 'l') || key === 'f6') {
        event.preventDefault()
        open('location')
      } else if (control && key === 'h') {
        event.preventDefault()
        browserPreferences.toggleHidden()
      } else if ((key === 'delete' || (event.altKey && key === 'enter')) && selected().length) {
        event.preventDefault()
        if (key === 'enter' && selected().length === 1) open('properties')
        else if (
          key === 'delete' &&
          selected().every((path) =>
            isPathEditable(path, host().editableFolders, host().mediaRoots),
          )
        ) {
          open('delete')
          owner.patch({ permanentDelete: event.shiftKey })
        }
      } else if (control && key === 'a') {
        event.preventDefault()
        owner.patch({
          selecting: true,
          selected: ordered.filter((f) => !f.isVirtual).map((f) => f.path),
        })
      } else if (key === 'escape') {
        event.preventDefault()
        clear()
      } else if (control && ['c', 'x'].includes(key) && selected().length) {
        event.preventDefault()
        copy(key === 'x')
      } else if (control && key === 'v' && fileJobs.read().clipboard) {
        event.preventDefault()
        paste()
      }
    },
    showApplications() {
      if (window.derpDesktop?.applications && selected()[0])
        runDesktopOperation(async () =>
          owner.patch({ applications: await window.derpDesktop!.applications!(selected()[0]!) }),
        )
    },
  }
}
export type FileTools = ReturnType<typeof createFileTools>
