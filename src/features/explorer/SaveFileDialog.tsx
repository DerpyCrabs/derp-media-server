import { BrowserDownload } from '@/lib/ui/browser-download'
import { Input } from '@/lib/ui/input'
import { Button } from '@/lib/ui/button'
import { Select } from '@/lib/ui/select'
import {
  controllerView,
  modelOwner,
  ownerController,
  view,
  available,
  resourceError,
  list,
} from 'effectweb'
import { AsyncResult } from 'effect/reactivity'
import { observeQuery, query } from '@effectweb/query'
import Folder from '@effectweb/lucide/icons/folder'
import ArrowUp from '@effectweb/lucide/icons/arrow-up'
import { groups, queryCache } from '@/lib/api/cache'
import { fetchDirectoryFilesEffect } from '@/lib/files/files-client'
import { fileNameFromPath, isPathEditable, parentPath } from '@/lib/files/path-utils'
import type { FileItem } from '@/lib/files/types'
import { Dialog } from '@/lib/ui/dialog'
import { type ModalOverlayScope } from './modal-overlay-scope'

export type SaveFileFormat = { value: string; extension: string; label: string }
type Props = {
  title?: string
  confirmLabel?: string
  suggestedPath: string
  editableFolders: readonly string[]
  formats?: readonly SaveFileFormat[]
  description?: string
  preview?: { src: string; alt: string }
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
      return { ...ownerController(owner), ...actions }
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
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close()
        }}
        title={props.title ?? 'Save as'}
        class='sm:max-w-lg max-h-[85dvh] overflow-y-auto'
        footer={
          <>
            <Button variant='outline' type='button' disabled={props.pending} onClick={close}>
              Cancel
            </Button>
            {props.onDownload ? (
              <BrowserDownload>
                <Button
                  variant='outline'
                  type='button'
                  disabled={props.pending || !validName(name)}
                  onClick={() => props.onDownload?.(name, model.format)}
                >
                  {props.pending ? 'Exporting…' : 'Download copy'}
                </Button>
              </BrowserDownload>
            ) : null}
            {canBrowse ? (
              <Button
                variant='default'
                type='button'
                disabled={props.pending || loading || Boolean(error) || !validName(name) || exists}
                onClick={model.actions.confirm}
              >
                {props.pending ? 'Saving…' : (props.confirmLabel ?? 'Save copy')}
              </Button>
            ) : null}
          </>
        }
      >
        {props.preview ? (
          <img
            src={props.preview.src}
            alt={props.preview.alt}
            class='max-h-32 w-full rounded bg-black object-contain'
          />
        ) : null}
        {canBrowse ? (
          <>
            {props.editableFolders.length > 1 ? (
              <label class='flex items-center gap-2 text-sm'>
                <span>Location</span>
                <Select
                  aria-label='Save location root'
                  class='min-w-0 w-full'
                  disabled={props.pending}
                  value={
                    props.editableFolders.find(
                      (root) =>
                        root === '' ||
                        model.directory === root ||
                        model.directory.startsWith(root + '/'),
                    ) ?? props.editableFolders[0]
                  }
                  onValueChange={(value) => model.actions.browse(value)}
                  options={props.editableFolders.map((root) => ({
                    value: root,
                    label: root || 'Library',
                  }))}
                />
              </label>
            ) : null}
            <div class='flex items-center gap-2 text-sm'>
              <Button
                size='icon'
                variant='ghost'
                type='button'
                aria-label='Parent destination folder'
                disabled={
                  props.pending || !model.directory || !isPathEditable(up, props.editableFolders)
                }
                onClick={() => model.actions.browse(up)}
              >
                <ArrowUp size={16} />
              </Button>
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
                    <Button
                      variant='ghost'
                      type='button'
                      disabled={props.pending}
                      class='flex w-full items-center gap-2 px-3 py-2 justify-start text-left text-sm hover:bg-muted'
                      onClick={() => model.actions.browse(folder.path)}
                    >
                      <Folder size={16} />
                      <span class='truncate'>{folder.name}</span>
                    </Button>
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
          <Input
            autofocus
            aria-label='File name'
            value={model.name}
            disabled={props.pending}
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
            <Select
              aria-label='Export format'
              value={model.format}
              disabled={props.pending}
              class='min-w-0 w-full'
              onValueChange={(value) => model.actions.format(value)}
              options={props.formats}
            />
          </label>
        ) : null}
        {exists && canBrowse ? (
          <p role='status' class='text-sm text-amber-600'>
            A file with this name already exists.
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
      </Dialog>
    )
  }),
)
