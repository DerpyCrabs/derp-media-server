import { Effect, Schema } from 'effect'
import { available, modelOwner } from 'effectweb'
import { query, observeQuery } from '@effectweb/query'
import { apiSchemaEffect } from '@/lib/api/client'
import { groups, queryCache } from '@/lib/api/cache'
import { directoryFilesSchema } from '@/lib/files/file-schemas'
import { isPathEditable } from '@/lib/files/path-utils'
import type { FileItem } from '@/lib/files/types'
import type { FileBrowserHost } from './FileBrowser'
import { fileJobs, type FileOperation } from './file-jobs'
import { selectFiles } from './file-selection'
import { runDesktopOperation } from '@/desktop/operations'

const hiddenQuery = query({
  name: 'hidden-directory',
  groups: [groups.files],
  load: (path: string) =>
    apiSchemaEffect(directoryFilesSchema, `/api/files/hidden?dir=${encodeURIComponent(path)}`),
})
const entrySchema = Schema.Struct({
  path: Schema.String,
  size: Schema.Number,
  directory: Schema.Boolean,
})
const archiveQuery = query({
  name: 'archive-contents',
  groups: [groups.files],
  load: (path: string) =>
    apiSchemaEffect(
      Schema.Struct({ entries: Schema.Array(entrySchema) }),
      `/api/files/archive?path=${encodeURIComponent(path)}`,
    ),
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
  | 'copy'
  | 'move'
  | 'extractArchive'
  | null
export function createFileTools(host: () => FileBrowserHost, files: () => readonly FileItem[]) {
  const owner = modelOwner({
    desktop: !!window.derpDesktop,
    selected: [] as string[],
    anchor: null as string | null,
    selecting: false,
    hidden: false,
    hiddenFiles: undefined as readonly FileItem[] | undefined,
    applyAll: false,
    filter: '',
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
    places: [] as { name: string; path: string }[],
    applications: [] as { id: string; name: string }[],
  })
  const hidden = observeQuery(owner, queryCache, hiddenQuery, (result) => {
    owner.patch({ hiddenFiles: available(result)?.files })
    if (result._tag === 'Failure') owner.patch({ error: 'Could not load hidden files.' })
  })
  const archive = observeQuery(owner, queryCache, archiveQuery, (result) => {
    owner.patch({ archive: available(result)?.entries, pending: result.waiting })
    if (result._tag === 'Failure')
      owner.patch({
        error:
          'Could not read this ZIP archive. It may be damaged, encrypted, or contain unsafe paths.',
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
    owner.patch({ panel, path: host().currentPath, error: '' })
    if (panel === 'operations') fileJobs.refresh()
    if (panel === 'properties' && selected()[0]) properties.select(selected()[0])
    if (panel === 'archive' && selected()[0]) {
      owner.patch({ members: [], archive: undefined })
      archive.select(selected()[0])
    }
    if (panel === 'menu' && window.derpDesktop?.places)
      runDesktopOperation(async () => owner.patch({ places: await window.derpDesktop!.places!() }))
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
      (window.derpDesktop?.resolvePath && path.startsWith('/')
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
    start,
    copy,
    paste,
    navigate,
    patch: owner.patch,
    toggleHidden: () => {
      const show = !owner.read().hidden
      owner.patch({ hidden: show })
      hidden.select(show ? host().currentPath : undefined)
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
    keyDown(event: KeyboardEvent, ordered: readonly FileItem[]) {
      if (
        event.defaultPrevented ||
        host().selection ||
        host().active === false ||
        document.querySelector('[role=dialog], [role=alertdialog]')
      )
        return
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('input, textarea, [contenteditable=true]')
      )
        return
      const key = event.key.toLowerCase(),
        control = event.ctrlKey || event.metaKey
      if (control && key === 'l') {
        event.preventDefault()
        open('location')
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
