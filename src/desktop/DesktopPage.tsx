import { Effect } from 'effect'
import ClipboardPaste from '@effectweb/lucide/icons/clipboard-paste'
import { flushDesktopClose } from './close-handlers'
import { available, modelOwner, view, controllerView } from 'effectweb'
import { queryCache } from '@/lib/api/cache'
import { settingsQuery, configQuery, type ServerConfig } from '@/lib/api/queries'
import type { WorkspaceSettings } from '@/workspace/model/workspace-settings-types'
import { FileBrowser, type FileBrowserHost } from '@/features/explorer/FileBrowser'
import { EMPTY_FILE_ICON_CONTEXT } from '@/features/explorer/file-icon'
import { ViewerPane } from '@/features/viewer/LazyViewerPane'
import { subscribeAdminEvents } from '@/lib/api/admin-events-stream'
import { navigateSearchParams, browserHistory } from '@/lib/browser/browser-history'
import { applyPathMutationToUrl } from '@/lib/browser/url-state-actions'
import { isPathEditable, parentPath } from '@/lib/files/path-utils'
import { FileSearchButton } from '@/features/explorer/FileSearchPalette'
import { ThemeSwitcher } from '@/media-center/ThemeSwitcher'
import type { DesktopTarget, PickerRequest } from './bridge'
import { PickerControls } from './PickerControls'
import { createPicker } from './picker-controller'
import { pickerFileVisible } from './picker-files'
import { runDesktopOperation } from './operations'
import { observeQuery } from '@effectweb/query'
function desktopController() {
  const bridge = window.derpDesktop
  const owner = modelOwner({
    bridge,
    location: browserHistory.model(),
    config: undefined as ServerConfig | undefined,
    settings: undefined as WorkspaceSettings | undefined,
    status: {} as { pending?: boolean; error?: string },
    pickerRequest: undefined as PickerRequest | undefined,
  })
  const params = () => new URLSearchParams(owner.read().location.search)
  const picker = createPicker({
    request: () => owner.read().pickerRequest as PickerRequest | undefined,
    directory: () => params().get('dir') ?? '',
    navigate: (path) => navigateSearchParams({ dir: path }, 'push'),
    bridge,
  })
  const config = observeQuery(owner, queryCache, configQuery, 'config', available)
  config.select(true)
  const settings = observeQuery(owner, queryCache, settingsQuery, 'settings', available)
  settings.select(true)
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
  const stopPicker = bridge?.onPicker?.((pickerRequest) => {
    owner.patch({ pickerRequest })
    picker.receive()
  })
  const stopOpen = bridge?.onOpen(receive),
    stopClose = bridge?.onBeforeClose(() => Effect.runPromise(flushDesktopClose()))
  if (bridge) runDesktopOperation(() => bridge.ready())
  const operation = (event: Event) =>
    owner.patch({ status: (event as CustomEvent<{ pending?: boolean; error?: string }>).detail })
  const escape = (event: KeyboardEvent) => {
    if (
      owner.read().pickerRequest &&
      event.key === 'Escape' &&
      !event.defaultPrevented &&
      !document.querySelector('[role=dialog], [role=alertdialog], [role=menu]')
    )
      bridge?.close()
  }
  window.addEventListener('keydown', escape)
  window.addEventListener('desktop-operation', operation)
  const stopEvents = subscribeAdminEvents(applyPathMutationToUrl)
  const update = () => {
    owner.patch({ location: browserHistory.model() })
    picker.receive()
    const path = params().get('viewing') || params().get('dir') || ''
    document.title = `${path.split('/').at(-1) || 'Library'} — Derp Media Server`
  }
  const stopHistory = browserHistory.subscribe(update)
  update()
  const presentation = modelOwner({ ...owner.read(), pickerState: picker.source.model() })
  const actions = {
    picker,
    setStatus: (status: { pending?: boolean; error?: string }) => owner.patch({ status }),
  }
  const stops = [
    owner.source.subscribe((state) => presentation.patch(state)),
    picker.source.subscribe((pickerState) => presentation.patch({ pickerState })),
  ]
  return {
    source: presentation.source,
    ...actions,
    dispose() {
      stops.forEach((stop) => stop())
      stopPicker?.()
      stopOpen?.()
      stopClose?.()
      stopEvents()
      stopHistory()
      window.removeEventListener('keydown', escape)
      window.removeEventListener('desktop-operation', operation)
      picker.dispose()
      owner.dispose()
      presentation.dispose()
    },
  }
}
export const DesktopPage = controllerView(
  { controller: desktopController },
  view((model) => {
    const { bridge } = model
    const { picker, setStatus } = model.actions
    const params = () => new URLSearchParams(model.location.search),
      status = () => model.status,
      pickerRequest = () => model.pickerRequest
    const directory = () => params().get('dir') ?? '',
      viewing = () => params().get('viewing') ?? '',
      warm = () => params().has('warm'),
      isViewer = () => params().get('mode') === 'viewer'
    const readerKind = () => {
      const kind = params().get('kind')
      return kind === 'pdf' || kind === 'book' || kind === 'folder' ? kind : null
    }
    const editableFolders = () => [...(model.config?.editableFolders ?? [])],
      mediaRoots = () =>
        (model.config?.mediaRoots ?? []).map((root) => ({
          ...root,
          editableFolders: [...root.editableFolders],
        })),
      knowledgeBases = () => [...(model.settings?.knowledgeBases ?? [])],
      customIcons = () => model.settings?.customIcons ?? {}
    const editable = () => isPathEditable(directory(), editableFolders(), mediaRoots())
    const open = (path: string, reader = false) => {
      if (bridge) runDesktopOperation(() => bridge.open(path, reader))
    }
    const host: FileBrowserHost = {
      layout: 'workspace',
      get selection() {
        return pickerRequest()
          ? {
              ...picker.selection,
              visible: (file: import('@/lib/files/types').FileItem) =>
                pickerFileVisible(file, model.pickerRequest, model.pickerState.filter),
              includes: (file: import('@/lib/files/types').FileItem) =>
                model.pickerState.selected.some((item) => item.path === file.path),
            }
          : undefined
      },
      currentPath: directory(),
      editableFolders: editableFolders(),
      mediaRoots: mediaRoots(),
      iconContext: {
        ...EMPTY_FILE_ICON_CONTEXT,
        knowledgeBases: knowledgeBases(),
        customIcons: customIcons(),
      },
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
          if (bridge) runDesktopOperation(() => bridge.copy([file.path]))
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
              if (bridge) runDesktopOperation(() => bridge.paste(directory()))
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
      const files = Array.from(event.dataTransfer.files)
      runDesktopOperation(() => bridge.openDrop(files))
    }
    return bridge ? (
      !warm() ? (
        <>
          {status().pending || status().error ? (
            <div
              role={status().error ? 'alert' : 'status'}
              class='fixed inset-x-4 top-2 z-[100] rounded border bg-background p-3 text-sm shadow-lg'
            >
              {status().error || 'Working…'}
              {status().error ? (
                <button type='button' class='float-right px-2' onClick={() => setStatus({})}>
                  Dismiss
                </button>
              ) : null}
            </div>
          ) : null}
          {isViewer() ? (
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
              {viewing() ? (
                <ViewerPane
                  presentation='embedded'
                  viewingPath={viewing()}
                  imageSeed={params().get('imageSeed')}
                  onImageSeedChange={(seed, path) =>
                    navigateSearchParams({ imageSeed: seed, viewing: path }, 'replace')
                  }
                  directory={directory()}
                  contentVisible={true}
                  active={true}
                  editableFolders={editableFolders()}
                  knowledgeBases={knowledgeBases()}
                  readerKind={readerKind()}
                  autoPlayVideo
                  showListenOnly={false}
                  onNavigateViewing={(path) => navigateSearchParams({ viewing: path }, 'replace')}
                  onClose={() => bridge?.close()}
                />
              ) : (
                <p class='p-6'>This file was removed. Close this window or open another file.</p>
              )}
            </div>
          ) : (
            <div class='fixed inset-0 flex min-h-0 flex-col overflow-hidden'>
              <FileBrowser host={host} />
              {((request) =>
                request ? (
                  <PickerControls
                    request={request}
                    picker={picker}
                    cancel={() => bridge?.close()}
                  />
                ) : null)(pickerRequest())}
            </div>
          )}
        </>
      ) : null
    ) : (
      <p class='p-6'>Open this page using derp-media-client.</p>
    )
  }),
)
