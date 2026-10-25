import { controllerView, modelOwner, view, available, resourceError, list } from 'effectweb'
import { AsyncResult } from 'effect/reactivity'
import { observeQuery, query } from '@effectweb/query'
import Folder from '@effectweb/lucide/icons/folder'
import ArrowUp from '@effectweb/lucide/icons/arrow-up'
import { groups, queryCache } from '@/lib/api/cache'
import { fetchDirectoryFilesEffect } from '@/lib/files/files-client'
import { fileNameFromPath, isPathEditable, parentPath } from '@/lib/files/path-utils'
import type { FileItem } from '@/lib/files/types'
import { modalFocus } from '@/lib/ui/modal-focus'
import { modalDialogBackdropClass, type ModalOverlayScope } from './modal-overlay-scope'

export type SaveFileFormat = { value: string; extension: string; label: string }
type Props = {
  title?: string
  suggestedPath: string
  editableFolders: readonly string[]
  formats?: readonly SaveFileFormat[]
  description?: string
  pending: boolean
  error?: string
  overlayScope?: ModalOverlayScope
  onConfirm: (path: string, format?: string) => void
  onDownload?: (name: string, format?: string) => void
  onClose: () => void
}
const destinations = query({
  name: 'save-file-destinations',
  groups: [groups.files],
  load: (path: string) => fetchDirectoryFilesEffect(path),
})
const validName = (name: string) =>
  name.trim().length > 0 &&
  name !== '.' &&
  name !== '..' &&
  !name.includes('/') &&
  !name.includes('\\') &&
  // File names must not contain ASCII control characters.
  // oxlint-disable-next-line no-control-regex
  !/[\u0000-\u001f]/.test(name) &&
  encodeURIComponent(name).replace(/%[A-F\d]{2}/gi, 'x').length <= 255
const withExtension = (name: string, extension: string) => {
  const dot = name.lastIndexOf('.')
  return `${dot > 0 ? name.slice(0, dot) : name}.${extension}`
}
export const SaveFileDialog = controllerView(
  {
    controller: (props: Props) => {
      const parent = parentPath(props.suggestedPath)
      const owner = modelOwner({
        props,
        directory: isPathEditable(parent, props.editableFolders)
          ? parent
          : (props.editableFolders[0] ?? ''),
        name: props.formats?.[0]
          ? withExtension(fileNameFromPath(props.suggestedPath), props.formats[0].extension)
          : fileNameFromPath(props.suggestedPath),
        format: props.formats?.[0]?.value,
        result: AsyncResult.initial<{ files: FileItem[] }, Error>(),
      })
      const observer = observeQuery(owner, queryCache, destinations, 'result')
      const select = () =>
        observer.select(
          owner.read().props.editableFolders.length ? owner.read().directory : undefined,
        )
      const actions = {
        name: (name: string) => owner.patch({ name }),
        browse: (directory: string) => {
          owner.patch({ directory })
          select()
        },
        format: (format: string) => {
          const option = owner.read().props.formats?.find((option) => option.value === format)
          if (option)
            owner.patch({ format, name: withExtension(owner.read().name, option.extension) })
        },
        confirm: () => {
          const model = owner.read()
          const name = model.name.trim()
          const path = model.directory ? `${model.directory}/${name}` : name
          if (
            !model.props.pending &&
            !model.result.waiting &&
            !!available(model.result) &&
            validName(name) &&
            isPathEditable(path, model.props.editableFolders) &&
            !available(model.result)?.files.some((file) => file.name === name)
          )
            model.props.onConfirm(path, model.format)
        },
      }
      select()
      return {
        source: owner.source,
        ...actions,
        receive: (next: Props) => owner.patch({ props: next }),
        lifetime: owner,
      }
    },
  },
  view((model) => {
    const props = model.props
    const files = available(model.result)?.files ?? []
    const folders = files.filter(
      (file) =>
        file.isDirectory && !file.isVirtual && isPathEditable(file.path, props.editableFolders),
    )
    const name = model.name.trim()
    const exists = files.some((file) => file.name === name)
    const loading = model.result.waiting || !available(model.result)
    const error = resourceError(model.result)
    const canBrowse = props.editableFolders.length > 0
    const up = parentPath(model.directory)
    const close = () => {
      if (!props.pending) props.onClose()
    }
    return (
      <div
        data-no-window-drag
        class={modalDialogBackdropClass(props.overlayScope)}
        onClick={(event) => {
          if (event.target === event.currentTarget) close()
        }}
      >
        <section
          role='dialog'
          aria-modal='true'
          aria-label={props.title ?? 'Save as'}
          use={modalFocus({ onEscape: close })}
          class='flex max-h-full w-full max-w-lg flex-col gap-3 overflow-auto rounded-lg border border-border bg-background p-4 text-foreground shadow-xl'
        >
          <h2 class='text-base font-semibold'>{props.title ?? 'Save as'}</h2>
          {canBrowse ? (
            <>
              {props.editableFolders.length > 1 ? (
                <label class='flex items-center gap-2 text-sm'>
                  <span>Location</span>
                  <select
                    aria-label='Save location root'
                    class='min-w-0 flex-1 rounded border border-input bg-background px-2 py-1.5'
                    disabled={props.pending}
                    value={
                      props.editableFolders.find(
                        (root) =>
                          root === '' ||
                          model.directory === root ||
                          model.directory.startsWith(root + '/'),
                      ) ?? props.editableFolders[0]
                    }
                    onChange={(event) => model.actions.browse(event.currentTarget.value)}
                  >
                    {list(
                      props.editableFolders,
                      (root) => root,
                      (root) => (
                        <option value={root}>{root || 'Library'}</option>
                      ),
                    )}
                  </select>
                </label>
              ) : null}
              <div class='flex items-center gap-2 text-sm'>
                <button
                  type='button'
                  aria-label='Parent destination folder'
                  disabled={
                    props.pending || !model.directory || !isPathEditable(up, props.editableFolders)
                  }
                  class='inline-flex size-8 shrink-0 items-center justify-center rounded hover:bg-muted disabled:opacity-40'
                  onClick={() => model.actions.browse(up)}
                >
                  <ArrowUp size={16} />
                </button>
                <span class='min-w-0 truncate' title={model.directory}>
                  {model.directory || 'Library'}
                </span>
              </div>
              <div
                class='max-h-48 min-h-20 overflow-auto rounded border border-border'
                aria-label='Destination folders'
              >
                {loading ? (
                  <p role='status' class='p-3 text-sm text-muted-foreground'>
                    Loading folders…
                  </p>
                ) : error ? (
                  <p role='alert' class='p-3 text-sm text-destructive'>
                    {error}
                  </p>
                ) : folders.length ? (
                  list(
                    folders,
                    (folder) => folder.path,
                    (folder) => (
                      <button
                        type='button'
                        disabled={props.pending}
                        class='flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted'
                        onClick={() => model.actions.browse(folder.path)}
                      >
                        <Folder size={16} />
                        <span class='truncate'>{folder.name}</span>
                      </button>
                    ),
                  )
                ) : (
                  <p class='p-3 text-sm text-muted-foreground'>No subfolders</p>
                )}
              </div>
            </>
          ) : null}
          <label class='space-y-1 text-sm'>
            <span>File name</span>
            <input
              autofocus
              aria-label='File name'
              value={model.name}
              disabled={props.pending}
              class='w-full rounded border border-input bg-background px-3 py-2'
              onInput={(event) => model.actions.name(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canBrowse && !loading && !error) {
                  event.preventDefault()
                  model.actions.confirm()
                }
              }}
            />
          </label>
          {props.formats?.length ? (
            <label class='flex items-center gap-2 text-sm'>
              <span>Format</span>
              <select
                aria-label='Export format'
                value={model.format}
                disabled={props.pending}
                class='min-w-0 flex-1 rounded border border-input bg-background px-2 py-1.5'
                onChange={(event) => model.actions.format(event.currentTarget.value)}
              >
                {list(
                  props.formats,
                  (format) => format.value,
                  (format) => (
                    <option value={format.value}>{format.label}</option>
                  ),
                )}
              </select>
            </label>
          ) : null}
          {exists && canBrowse ? (
            <p role='status' class='text-sm text-amber-600'>
              A file with this name already exists. Choose another name.
            </p>
          ) : null}
          {props.description ? (
            <p class='text-xs text-muted-foreground'>{props.description}</p>
          ) : null}
          {props.error ? (
            <p role='alert' class='text-sm text-destructive'>
              {props.error}
            </p>
          ) : null}
          <div class='flex flex-wrap justify-end gap-2'>
            <button
              type='button'
              class='rounded border border-input px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-40'
              disabled={props.pending}
              onClick={close}
            >
              Cancel
            </button>
            {props.onDownload ? (
              <button
                type='button'
                class='rounded border border-input px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-40'
                disabled={props.pending || !validName(name)}
                onClick={() => props.onDownload?.(name, model.format)}
              >
                {props.pending ? 'Exporting…' : 'Download copy'}
              </button>
            ) : null}
            {canBrowse ? (
              <button
                type='button'
                class='rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-40'
                disabled={props.pending || loading || Boolean(error) || !validName(name) || exists}
                onClick={model.actions.confirm}
              >
                {props.pending ? 'Saving…' : 'Save copy'}
              </button>
            ) : null}
          </div>
        </section>
      </div>
    )
  }),
)
