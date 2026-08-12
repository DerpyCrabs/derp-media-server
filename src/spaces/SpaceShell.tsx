import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import type { ShareLink } from '@/lib/shares'
import type { Space, SpacePane, SpaceSummary } from '@/lib/space'
import type {
  OptimisticSpaceClient,
  OptimisticSpaceSnapshot,
  SpaceTransport,
} from '@/lib/space-client'
import { isPathEditable } from '@/lib/utils'
import type { SpacePresentation } from '../lib/routes'
import { followAppLink, hrefFor, hrefForSpace, navigate, navigateSpace } from '../lib/routes'
import { useQuery } from '@tanstack/solid-query'
import Copy from 'lucide-solid/icons/copy'
import FolderPlus from 'lucide-solid/icons/folder-plus'
import LinkIcon from 'lucide-solid/icons/link'
import Ellipsis from 'lucide-solid/icons/ellipsis'
import Redo2 from 'lucide-solid/icons/redo-2'
import Trash2 from 'lucide-solid/icons/trash-2'
import Undo2 from 'lucide-solid/icons/undo-2'
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  lazy,
  onCleanup,
  type Accessor,
  type JSX,
} from 'solid-js'
import { SpaceRevisionControl } from './SpaceRevisionControl'

const ShareDialog = lazy(() =>
  import('../file-browser/ShareDialog').then((module) => ({ default: module.ShareDialog })),
)

type AuthConfig = { shareLinkDomain?: string; editableFolders?: string[] }

function panePath(pane: SpacePane | undefined): string | null {
  if (!pane) return null
  const initialState = pane.state.initialState
  if (!initialState || typeof initialState !== 'object' || Array.isArray(initialState)) return null
  const state = initialState as Record<string, unknown>
  const path = typeof state.viewing === 'string' ? state.viewing : state.dir
  return typeof path === 'string' && path ? path.replaceAll('\\', '/') : null
}

function paneTitle(pane: SpacePane | undefined, path: string): string {
  const title = pane?.state.title
  return typeof title === 'string' && title.trim()
    ? title
    : (path.split('/').filter(Boolean).at(-1) ?? path)
}

function libraryPane(): SpacePane {
  return {
    kind: 'browser',
    state: {
      title: 'Library',
      iconName: null,
      iconPath: '',
      iconIsVirtual: false,
      source: { kind: 'local', rootPath: null },
      initialState: { dir: '' },
      tabGroupId: null,
    },
  }
}

export function SpaceShell(props: {
  snapshot: Accessor<OptimisticSpaceSnapshot>
  client: OptimisticSpaceClient
  transport: SpaceTransport
  presentation: Accessor<SpacePresentation>
  activePaneId: Accessor<string | null>
  activeRuntimePath?: Accessor<string | undefined>
  onActivePaneChange: (paneId: string | null) => void
  onPresentationChange: (presentation: SpacePresentation) => void
  onBeforeNavigate: () => void
  children: JSX.Element
}) {
  const space = () => props.snapshot().space!
  const [draftName, setDraftName] = createSignal(space().name)
  const [actionError, setActionError] = createSignal<string | null>(null)
  const [undoRevisions, setUndoRevisions] = createSignal<number[]>([])
  const [redoRevisions, setRedoRevisions] = createSignal<number[]>([])
  const [shareOpen, setShareOpen] = createSignal(false)
  const [mobileActionsOpen, setMobileActionsOpen] = createSignal(false)
  let syncedName = space().name

  const unsubscribeCommands = props.client.subscribeCommands(({ command, beforeRevision }) => {
    if (
      command.type === 'create' ||
      command.type === 'duplicate' ||
      command.type === 'delete' ||
      command.type === 'restoreRevision'
    ) {
      return
    }
    setUndoRevisions((current) =>
      current.at(-1) === beforeRevision ? current : [...current, beforeRevision],
    )
    setRedoRevisions([])
  })
  onCleanup(unsubscribeCommands)

  createEffect(() => {
    const name = space().name
    if (name === syncedName) return
    syncedName = name
    setDraftName(name)
  })

  const spacesQuery = useQuery(() => ({
    queryKey: queryKeys.spaces(),
    queryFn: () => props.transport.list(),
    staleTime: 0,
  }))
  const sharesQuery = useQuery(() => ({
    queryKey: queryKeys.shares(),
    queryFn: () => api<{ shares: ShareLink[] }>('/api/shares'),
  }))
  const authQuery = useQuery(() => ({
    queryKey: queryKeys.authConfig(),
    queryFn: () => api<AuthConfig>('/api/auth/config'),
    staleTime: Infinity,
  }))

  const activePane = createMemo(() => {
    const paneId = props.activePaneId()
    return paneId ? space().panes[paneId] : undefined
  })
  const activePath = createMemo(() => props.activeRuntimePath?.() ?? panePath(activePane()))
  const activeShares = createMemo(() => {
    const path = activePath()
    return path
      ? (sharesQuery.data?.shares ?? []).filter(
          (share) => share.path.replaceAll('\\', '/') === path,
        )
      : []
  })
  const shareBase = () => {
    const configured = authQuery.data?.shareLinkDomain?.trim().replace(/\/$/, '')
    return configured || window.location.origin
  }

  async function run(action: () => Promise<unknown>) {
    setActionError(null)
    try {
      await action()
      void spacesQuery.refetch()
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Space action failed')
    }
  }

  async function saveBeforeLeave() {
    props.onBeforeNavigate()
    try {
      await props.client.waitForIdle()
      return true
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? `Space was not left because changes are unsaved: ${cause.message}`
          : 'Space was not left because changes are unsaved',
      )
      return false
    }
  }

  function handlesPlainClick(event: MouseEvent) {
    return (
      event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
    )
  }

  function commitName() {
    const name = draftName().trim()
    if (!name || name === space().name) {
      setDraftName(space().name)
      return
    }
    props.onBeforeNavigate()
    void run(() => props.client.dispatch({ type: 'rename', name }))
  }

  function addResource() {
    const paneId = `space-pane-${crypto.randomUUID()}`
    props.onBeforeNavigate()
    void run(async () => {
      await props.client.dispatch({ type: 'addPane', paneId, pane: libraryPane() })
      props.onActivePaneChange(paneId)
    })
  }

  function undo() {
    props.onBeforeNavigate()
    void run(async () => {
      await props.client.waitForIdle()
      const target = undoRevisions().at(-1)
      if (target === undefined) return
      const currentRevision = space().revision
      const restored = await props.client.dispatch({ type: 'restoreRevision', revision: target })
      setUndoRevisions((current) => current.slice(0, -1))
      setRedoRevisions((current) => [...current, currentRevision])
      props.onActivePaneChange(Object.keys(restored.panes)[0] ?? null)
    })
  }

  function redo() {
    props.onBeforeNavigate()
    void run(async () => {
      await props.client.waitForIdle()
      const target = redoRevisions().at(-1)
      if (target === undefined) return
      const currentRevision = space().revision
      const restored = await props.client.dispatch({ type: 'restoreRevision', revision: target })
      setRedoRevisions((current) => current.slice(0, -1))
      setUndoRevisions((current) => [...current, currentRevision])
      props.onActivePaneChange(Object.keys(restored.panes)[0] ?? null)
    })
  }

  function duplicate() {
    const id = crypto.randomUUID()
    void run(async () => {
      if (!(await saveBeforeLeave())) return
      const copy = await props.client.dispatch({
        type: 'duplicate',
        sourceRevision: space().revision,
        newId: id,
        name: `${space().name.slice(0, 115).trimEnd()} copy`,
      })
      navigateSpace(copy.id, { presentation: props.presentation() })
    })
  }

  function deleteSpace() {
    if (!window.confirm(`Delete "${space().name}"? Files inside Panes remain untouched.`)) return
    void run(async () => {
      if (!(await saveBeforeLeave())) return
      await props.client.dispatch({ type: 'delete' })
      navigate({ kind: 'spaces' }, { replace: true })
    })
  }

  return (
    <main class='fixed inset-0 z-[100000] flex min-h-0 flex-col overflow-hidden bg-background'>
      <header
        class='relative z-[106000] flex min-h-14 shrink-0 flex-wrap items-center gap-1 border-b border-border bg-card/95 px-2 py-1 backdrop-blur md:flex-nowrap md:gap-2 md:py-0'
        data-testid='space-shell'
      >
        <a
          href={hrefFor({ kind: 'spaces' })}
          class='inline-flex min-h-10 shrink-0 items-center rounded-md px-2 text-sm font-semibold hover:bg-muted'
          onClick={(event) => {
            if (!handlesPlainClick(event)) return
            event.preventDefault()
            void saveBeforeLeave().then((saved) => {
              if (saved) navigate({ kind: 'spaces' })
            })
          }}
        >
          Spaces
        </a>
        <select
          aria-label='Space picker'
          data-testid='space-picker'
          class='h-10 w-20 min-w-0 rounded-md border border-input bg-background px-1 text-sm sm:w-32 md:max-w-44 md:flex-1'
          value={space().id}
          onChange={(event) => {
            const id = event.currentTarget.value
            event.currentTarget.value = space().id
            void saveBeforeLeave().then((saved) => {
              if (saved) navigateSpace(id, { presentation: props.presentation() })
            })
          }}
        >
          <For each={spacesQuery.data ?? []}>
            {(item: SpaceSummary) => (
              <Show when={item.deletedAt === undefined}>
                <option value={item.id}>{item.name}</option>
              </Show>
            )}
          </For>
        </select>
        <input
          aria-label='Space name'
          data-testid='space-name'
          class='h-10 min-w-16 flex-1 rounded-md border border-transparent bg-transparent px-1 text-sm font-semibold hover:border-input focus:border-input md:min-w-24 md:px-2'
          maxlength={120}
          value={draftName()}
          onInput={(event) => setDraftName(event.currentTarget.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              setDraftName(space().name)
              event.currentTarget.blur()
            }
          }}
        />
        <span
          class='hidden min-w-16 text-center text-xs capitalize text-muted-foreground sm:inline'
          data-testid='space-sync-status'
          title={props.snapshot().error ?? undefined}
        >
          {props.snapshot().status}
        </span>
        <nav
          class='order-last flex basis-full justify-center rounded-lg border border-border bg-background p-0.5 md:order-none md:basis-auto md:shrink-0'
          aria-label='Space presentation'
        >
          <For each={['focus', 'tiled', 'map'] as const}>
            {(presentation) => {
              const href = () =>
                hrefForSpace(space().id, {
                  presentation,
                  history: window.location.hash === '#history',
                })
              return (
                <a
                  href={href()}
                  aria-current={props.presentation() === presentation ? 'page' : undefined}
                  class='inline-flex min-h-9 items-center rounded-md px-2 text-xs font-medium capitalize text-muted-foreground aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground'
                  onClick={(event) => {
                    props.onBeforeNavigate()
                    props.onPresentationChange(presentation)
                    followAppLink(event, href())
                  }}
                >
                  {presentation}
                </a>
              )
            }}
          </For>
        </nav>
        <button
          type='button'
          class='inline-flex size-10 shrink-0 items-center justify-center rounded-md hover:bg-muted md:hidden'
          aria-label='Space actions'
          aria-expanded={mobileActionsOpen()}
          onClick={() => setMobileActionsOpen((open) => !open)}
        >
          <Ellipsis class='size-4' />
        </button>
        <div
          class='absolute top-full right-2 z-50 w-56 flex-col gap-1 rounded-lg border border-border bg-popover p-2 shadow-xl md:static md:z-auto md:flex md:w-auto md:shrink-0 md:flex-row md:border-0 md:bg-transparent md:p-0 md:shadow-none'
          classList={{ flex: mobileActionsOpen(), hidden: !mobileActionsOpen() }}
        >
          <button
            type='button'
            class='inline-flex min-h-10 items-center gap-2 rounded-md px-2 hover:bg-muted disabled:opacity-35 md:size-10 md:justify-center md:px-0'
            aria-label='Undo Space change'
            disabled={undoRevisions().length === 0 || props.snapshot().pending > 0}
            onClick={undo}
          >
            <Undo2 class='size-4' />
            <span class='md:sr-only'>Undo</span>
          </button>
          <button
            type='button'
            class='inline-flex min-h-10 items-center gap-2 rounded-md px-2 hover:bg-muted disabled:opacity-35 md:size-10 md:justify-center md:px-0'
            aria-label='Redo Space change'
            disabled={redoRevisions().length === 0 || props.snapshot().pending > 0}
            onClick={redo}
          >
            <Redo2 class='size-4' />
            <span class='md:sr-only'>Redo</span>
          </button>
          <button
            type='button'
            class='inline-flex min-h-10 items-center gap-1 rounded-md px-2 text-xs font-medium hover:bg-muted'
            data-testid='space-add-resource'
            onClick={() => {
              setMobileActionsOpen(false)
              addResource()
            }}
          >
            <FolderPlus class='size-4' /> Add Resource
          </button>
          <button
            type='button'
            class='inline-flex min-h-10 items-center gap-1 rounded-md px-2 text-xs font-medium hover:bg-muted disabled:opacity-35'
            disabled={!activePath()}
            data-testid='space-share-resource'
            onClick={() => {
              setMobileActionsOpen(false)
              props.onBeforeNavigate()
              setShareOpen(true)
            }}
          >
            <LinkIcon class='size-4' /> Share Resource
          </button>
          <button
            type='button'
            class='inline-flex min-h-10 items-center gap-2 rounded-md px-2 hover:bg-muted md:size-10 md:justify-center md:px-0'
            aria-label='Duplicate Space'
            onClick={() => {
              setMobileActionsOpen(false)
              duplicate()
            }}
          >
            <Copy class='size-4' />
            <span class='md:sr-only'>Duplicate</span>
          </button>
          <button
            type='button'
            class='inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-destructive hover:bg-destructive/10 md:size-10 md:justify-center md:px-0'
            aria-label='Delete Space'
            onClick={() => {
              setMobileActionsOpen(false)
              deleteSpace()
            }}
          >
            <Trash2 class='size-4' />
            <span class='md:sr-only'>Delete</span>
          </button>
        </div>
        <SpaceRevisionControl
          space={space}
          transport={props.transport}
          client={props.client}
          onBeforeAction={props.onBeforeNavigate}
          compact
          triggerClass='inline-flex size-10 shrink-0 items-center justify-center rounded-md hover:bg-muted'
          onRestored={(restored) => {
            if (restored.id !== space().id) {
              navigateSpace(restored.id, { presentation: props.presentation() })
            }
          }}
        />
      </header>
      <Show when={actionError()}>
        {(message) => (
          <div class='border-destructive/40 bg-destructive/5 relative z-[105000] border-b px-3 py-2 text-xs text-destructive'>
            {message()}
          </div>
        )}
      </Show>
      <div class='relative min-h-0 flex-1'>{props.children}</div>
      <Show when={shareOpen() && activePath()}>
        {(path) => (
          <ShareDialog
            isOpen
            onClose={() => setShareOpen(false)}
            filePath={path()}
            fileName={paneTitle(activePane(), path())}
            isDirectory={activePane()?.kind === 'browser'}
            isEditable={isPathEditable(path(), authQuery.data?.editableFolders ?? [])}
            existingShares={activeShares()}
            shareLinkBase={shareBase()}
          />
        )}
      </Show>
    </main>
  )
}
