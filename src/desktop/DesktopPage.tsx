import ClipboardPaste from 'lucide-solid/icons/clipboard-paste'
import { flushDesktopClose } from './close-handlers'
import { createEffect, createMemo, createSignal, onSettled, Show } from 'solid-js'
import { FileBrowser, type FileBrowserHost } from '@/features/explorer/FileBrowser'
import { useExplorerSettings } from '@/features/explorer/use-explorer-settings'
import { EMPTY_FILE_ICON_CONTEXT } from '@/features/explorer/use-file-icon'
import { ViewerPane } from '@/features/viewer/ViewerPane'
import { useServerConfigQuery } from '@/lib/api/use-app-data'
import { useAdminEventsStream } from '@/lib/api/use-admin-events-stream'
import {
  createUrlSearchParamsMemo,
  navigateSearchParams,
  useBrowserHistory,
} from '@/lib/browser/browser-history'
import { applyPathMutationToUrl } from '@/lib/browser/url-state-actions'
import { isPathEditable, parentPath } from '@/lib/files/path-utils'
import { FileSearchButton } from '@/features/explorer/FileSearchPalette'
import { ThemeSwitcher } from '@/media-center/ThemeSwitcher'
import type { DesktopTarget, PickerRequest } from './bridge'
import { createPicker, PickerControls } from './PickerControls'
import { runDesktopOperation } from './operations'

export function DesktopPage() {
  const bridge = window.derpDesktop
  const params = createUrlSearchParamsMemo(useBrowserHistory())
  const config = useServerConfigQuery()
  const { knowledgeBases, customIcons } = useExplorerSettings()
  const [status, setStatus] = createSignal<{ pending?: boolean; error?: string }>({})
  const directory = createMemo(() => params().get('dir') ?? '')
  const viewing = createMemo(() => params().get('viewing') ?? '')
  const warm = createMemo(() => params().has('warm'))
  const readerKind = createMemo(() => {
    const kind = params().get('kind')
    return kind === 'pdf' || kind === 'book' || kind === 'folder' ? kind : null
  })
  const isViewer = createMemo(() => params().get('mode') === 'viewer')
  const editableFolders = createMemo(() => [...(config.data?.editableFolders ?? [])])
  const mediaRoots = createMemo(() => [...(config.data?.mediaRoots ?? [])])
  const editable = createMemo(() => isPathEditable(directory(), editableFolders(), mediaRoots()))

  const [pickerRequest, setPickerRequest] = createSignal<PickerRequest>()
  const picker = createPicker({
    request: pickerRequest,
    directory,
    navigate: (path) => navigateSearchParams({ dir: path }, 'push'),
    bridge,
  })

  function receive(target: DesktopTarget) {
    const viewer = !target.isDirectory || target.reader
    const kind =
      target.reader && target.isDirectory
        ? 'folder'
        : target.mediaType === 'pdf' || target.mediaType === 'book'
          ? target.mediaType
          : null
    navigateSearchParams(
      {
        warm: null,
        mode: viewer ? 'viewer' : 'browser',
        dir: viewer ? parentPath(target.path) : target.path,
        viewing: viewer ? target.path : null,
        kind,
      },
      'replace',
    )
  }

  onSettled(() => {
    const stopPicker = bridge?.onPicker?.(setPickerRequest)
    const stop = bridge?.onOpen(receive)
    const stopClose = bridge?.onBeforeClose(flushDesktopClose)
    if (bridge) runDesktopOperation(bridge.ready())
    const operation = (event: Event) =>
      setStatus((event as CustomEvent<{ pending?: boolean; error?: string }>).detail)
    const escape = (event: KeyboardEvent) => {
      if (
        pickerRequest() &&
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        !document.querySelector('[role=dialog], [role=alertdialog], [role=menu]')
      )
        bridge?.close()
    }
    window.addEventListener('keydown', escape)
    window.addEventListener('desktop-operation', operation)
    return () => {
      stopPicker?.()
      stop?.()
      stopClose?.()
      window.removeEventListener('keydown', escape)
      window.removeEventListener('desktop-operation', operation)
    }
  })
  useAdminEventsStream(true, applyPathMutationToUrl)
  createEffect(
    () => viewing() || directory(),
    (path) => {
      document.title = `${path.split('/').at(-1) || 'Library'} — Derp Media Server`
    },
  )

  const open = (path: string, reader = false) => {
    if (bridge) runDesktopOperation(bridge.open(path, reader))
  }
  const host: FileBrowserHost = {
    layout: 'workspace',
    get selection() {
      return pickerRequest() ? picker.selection : undefined
    },
    currentPath: directory,
    editableFolders,
    mediaRoots,
    iconContext: () => ({
      ...EMPTY_FILE_ICON_CONTEXT,
      knowledgeBases: knowledgeBases(),
      customIcons: customIcons(),
    }),
    navigate: (path) => navigateSearchParams({ dir: path }, 'push'),
    present: (request) => {
      if (pickerRequest()) {
        picker.selection.activate(request.file)
        return
      }
      if (request.kind === 'virtual') {
        setStatus({ error: 'This virtual item cannot be opened in a desktop viewer.' })
        return
      }
      open(request.file.path, request.kind === 'reader')
    },
    actions: {
      otherSurfaceLabel: 'Open in new window',
      newTabLabel: 'Open in new window',
      openNewTab: (file, dir) => open(file?.path ?? dir),
      openInNewWindow: (file) => open(file.path),
      copyToClipboard: (file) => {
        if (bridge) runDesktopOperation(bridge.copy([file.path]))
      },
    },
    toolbarExtras: () => (
      <>
        <FileSearchButton
          title='Search library'
          class='inline-flex h-7 w-7 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
          iconClass='h-3.5 w-3.5'
          onSelect={(file) => {
            if (file.isDirectory) host.navigate(file.path)
            else if (pickerRequest()) picker.selection.activate({ ...file, size: 0 })
            else open(file.path)
          }}
        />
        <button
          type='button'
          title='Paste files (Ctrl+V)'
          aria-label='Paste files'
          class='inline-flex h-7 w-7 shrink-0 items-center justify-center text-sm font-medium transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40'
          disabled={!editable()}
          onClick={() => {
            if (bridge) runDesktopOperation(bridge.paste(directory()))
          }}
        >
          <ClipboardPaste class='h-3.5 w-3.5' aria-hidden='true' stroke-width={2} />
        </button>
        <ThemeSwitcher compact />
      </>
    ),
  }

  function dropOnViewer(event: DragEvent) {
    if (!event.dataTransfer?.files.length || !bridge) return
    event.preventDefault()
    runDesktopOperation(bridge.openDrop(Array.from(event.dataTransfer.files)))
  }

  return (
    <Show when={bridge} fallback={<p class='p-6'>Open this page using derp-media-client.</p>}>
      <Show when={!warm()}>
        <Show when={status().pending || status().error}>
          <div
            role={status().error ? 'alert' : 'status'}
            class='fixed inset-x-4 top-2 z-[100] rounded border bg-background p-3 text-sm shadow-lg'
          >
            {status().error || 'Working…'}
            <Show when={status().error}>
              <button type='button' class='float-right px-2' onClick={() => setStatus({})}>
                Dismiss
              </button>
            </Show>
          </div>
        </Show>
        <Show
          when={isViewer()}
          fallback={
            <div class='fixed inset-0 flex min-h-0 flex-col overflow-hidden'>
              <FileBrowser host={host} />
              <Show when={pickerRequest()}>
                {(request) => (
                  <PickerControls
                    request={request()}
                    picker={picker}
                    cancel={() => bridge?.close()}
                  />
                )}
              </Show>
            </div>
          }
        >
          <div
            class='fixed inset-0'
            onDrop={dropOnViewer}
            onDragOver={(event) => {
              if (event.dataTransfer?.types.includes('Files')) {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'copy'
              }
            }}
          >
            <Show
              when={viewing()}
              fallback={
                <p class='p-6'>This file was removed. Close this window or open another file.</p>
              }
            >
              <ViewerPane
                presentation='embedded'
                viewingPath={viewing}
                imageSeed={() => params().get('imageSeed')}
                onImageSeedChange={(seed, path) =>
                  navigateSearchParams({ imageSeed: seed, viewing: path }, 'replace')
                }
                directory={directory}
                contentVisible={() => true}
                active={() => true}
                editableFolders={editableFolders()}
                knowledgeBases={knowledgeBases()}
                readerKind={readerKind}
                autoPlayVideo
                showListenOnly={false}
                onNavigateViewing={(path) => navigateSearchParams({ viewing: path }, 'replace')}
                onClose={() => bridge?.close()}
              />
            </Show>
          </div>
        </Show>
      </Show>
    </Show>
  )
}
