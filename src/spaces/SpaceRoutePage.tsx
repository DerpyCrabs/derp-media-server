import { queryKeys } from '@/lib/query-keys'
import { defaultSpacePresentation, spacePresentationStorageKey } from '@/lib/space-presentation'
import { loadSpaceCommandJournal, saveSpaceCommandJournal } from '@/lib/space-command-journal'
import type { Space } from '@/lib/space'
import {
  createBrowserSpaceTransport,
  createOptimisticSpaceClient,
  isSpaceCommandSatisfied,
  type OptimisticSpaceSnapshot,
  type SpaceTransport,
} from '@/lib/space-client'
import { useQuery } from '@tanstack/solid-query'
import {
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  lazy,
  onCleanup,
  onMount,
} from 'solid-js'
import { followAppLink, hrefFor, navigateSpace, type SpacePresentation } from '../lib/routes'
import { SpaceShell } from './SpaceShell'
import { SpaceRevisionControl } from './SpaceRevisionControl'
import { createSpacePaneRuntime, PaneRuntimeProvider } from './pane-runtime'

const FocusSpacePage = lazy(() =>
  import('./FocusSpacePage').then((module) => ({ default: module.FocusSpacePage })),
)
const TiledSpacePage = lazy(() =>
  import('../WorkspacePage').then((module) => ({ default: module.WorkspacePage })),
)
const MapSpacePage = lazy(() =>
  import('../CanvasPage').then((module) => ({ default: module.CanvasPage })),
)

function SpaceExperience(props: {
  initialSpace: NonNullable<OptimisticSpaceSnapshot['space']>
  explicitPresentation?: SpacePresentation
  transport: SpaceTransport
}) {
  const transport = props.transport
  const client = createOptimisticSpaceClient({ transport, initialSpace: props.initialSpace })
  const paneRuntime = createSpacePaneRuntime(props.initialSpace.id)
  const [snapshot, setSnapshot] = createSignal(client.getSnapshot())
  const [activePaneId, setActivePaneId] = createSignal<string | null>(null)
  let activePresentationFlush: (() => void) | null = null
  let knownPaneIds = new Set(Object.keys(props.initialSpace.panes))
  const storageKey = spacePresentationStorageKey(props.initialSpace.id)
  let stored: string | null = null
  try {
    stored = localStorage.getItem(storageKey)
  } catch {}
  const [barePresentation, setBarePresentation] = createSignal(
    defaultSpacePresentation({
      stored,
      narrow: window.matchMedia('(max-width: 767px)').matches,
      origin: props.initialSpace.origin,
    }),
  )
  const requestedPresentation = createMemo(() => props.explicitPresentation ?? barePresentation())
  const [presentation, setPresentation] = createSignal(requestedPresentation())

  function syncCommandJournal() {
    saveSpaceCommandJournal(localStorage, props.initialSpace.id, client.getPendingCommands())
  }

  const unsubscribeJournal = client.subscribe(syncCommandJournal)
  const resumedCommands = loadSpaceCommandJournal(localStorage, props.initialSpace.id)
  for (const entry of resumedCommands) {
    try {
      const current = client.getSnapshot().space
      if (current && isSpaceCommandSatisfied(current, entry.command)) continue
      void client.dispatch(entry.command, { commandId: entry.commandId }).catch(syncCommandJournal)
    } catch {}
  }
  syncCommandJournal()

  function registerPresentationFlush(flush: () => void) {
    activePresentationFlush = flush
    return () => {
      if (activePresentationFlush === flush) activePresentationFlush = null
    }
  }

  function flushActivePresentation() {
    activePresentationFlush?.()
  }

  function rememberPresentation(next: SpacePresentation) {
    setBarePresentation(next)
    try {
      localStorage.setItem(storageKey, next)
    } catch {}
  }

  createEffect(() => {
    if (props.explicitPresentation) rememberPresentation(props.explicitPresentation)
  })

  createEffect(() => {
    const next = requestedPresentation()
    if (next === presentation()) return
    flushActivePresentation()
    setPresentation(next)
  })

  const unsubscribe = client.subscribe(() => {
    const next = client.getSnapshot()
    setSnapshot(next)
    const nextPaneIds = new Set(Object.keys(next.space?.panes ?? {}))
    for (const paneId of knownPaneIds) {
      if (!nextPaneIds.has(paneId)) {
        queueMicrotask(() => {
          if (!Object.hasOwn(client.getSnapshot().space?.panes ?? {}, paneId)) {
            paneRuntime.forget(paneId)
          }
        })
      }
    }
    knownPaneIds = nextPaneIds
    const current = activePaneId()
    if (current && next.space && !Object.hasOwn(next.space.panes, current)) {
      setActivePaneId(Object.keys(next.space.panes)[0] ?? null)
    }
  })

  onMount(() => {
    const online = () => client.setOnline(true)
    const offline = () => client.setOnline(false)
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    onCleanup(() => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
    })
  })

  onCleanup(() => {
    flushActivePresentation()
    unsubscribe()
    paneRuntime.dispose()
    syncCommandJournal()
    const current = client.getSnapshot()
    if (current.pending > 0 && current.status === 'saving') {
      void client
        .waitForIdle()
        .catch(() => undefined)
        .finally(() => {
          syncCommandJournal()
          unsubscribeJournal()
          client.dispose()
        })
      return
    }
    unsubscribeJournal()
    client.dispose()
  })

  const space = () => snapshot().space!

  return (
    <Show
      when={space().deletedAt === undefined}
      fallback={
        <main
          class='flex min-h-[70vh] items-center justify-center p-4'
          data-testid='space-deleted-recovery'
        >
          <div class='bg-card w-full max-w-md rounded-xl border border-border p-6 text-center'>
            <p class='text-muted-foreground text-sm font-medium'>Deleted Space</p>
            <h1 class='mt-1 text-xl font-semibold'>{space().name}</h1>
            <p class='text-muted-foreground mt-2 text-sm'>
              This Space is deleted. Open its revision history from Spaces to restore a retained
              version or duplicate one as a new Space.
            </p>
            <a
              href={hrefFor({ kind: 'spaces' })}
              class='mt-4 inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium'
              onClick={(event) => followAppLink(event, hrefFor({ kind: 'spaces' }))}
            >
              All Spaces
            </a>
            <div class='mt-3 flex justify-center'>
              <SpaceRevisionControl
                space={space}
                transport={transport}
                client={client}
                onBeforeAction={flushActivePresentation}
                onRestored={(restored) => {
                  if (restored.id !== space().id) {
                    navigateSpace(restored.id, { presentation: presentation() })
                  }
                }}
              />
            </div>
          </div>
        </main>
      }
    >
      <PaneRuntimeProvider runtime={paneRuntime}>
        <SpaceShell
          snapshot={snapshot}
          client={client}
          transport={transport}
          presentation={presentation}
          activePaneId={activePaneId}
          activeRuntimePath={() => {
            const paneId = activePaneId()
            return paneId ? paneRuntime.activePath(paneId) : undefined
          }}
          onActivePaneChange={setActivePaneId}
          onPresentationChange={rememberPresentation}
          onBeforeNavigate={flushActivePresentation}
        >
          <Switch>
            <Match when={presentation() === 'focus'}>
              <FocusSpacePage
                space={space}
                client={client}
                activePaneId={activePaneId}
                onActivePaneChange={setActivePaneId}
                onAddResource={() => {
                  document.querySelector<HTMLElement>('[data-testid="space-add-resource"]')?.click()
                }}
                registerPresentationFlush={registerPresentationFlush}
              />
            </Match>
            <Match when={presentation() === 'tiled'}>
              <TiledSpacePage
                initialSpace={space()}
                spaceClient={client}
                activePaneId={activePaneId()}
                onActivePaneChange={setActivePaneId}
                registerPresentationFlush={registerPresentationFlush}
                embedded
              />
            </Match>
            <Match when={presentation() === 'map'}>
              <MapSpacePage
                initialSpace={space()}
                spaceClient={client}
                activePaneId={activePaneId()}
                onActivePaneChange={setActivePaneId}
                registerPresentationFlush={registerPresentationFlush}
                embedded
              />
            </Match>
          </Switch>
        </SpaceShell>
      </PaneRuntimeProvider>
    </Show>
  )
}

export function SpaceRoutePage(props: { spaceId: string; presentation?: SpacePresentation }) {
  const transport = createBrowserSpaceTransport()
  const spaceQuery = useQuery(() => ({
    queryKey: queryKeys.space(props.spaceId),
    queryFn: async () => ({ space: await transport.load(props.spaceId) }),
    select: (data) => data.space,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  }))
  const [initialSpace, setInitialSpace] = createSignal<Space>()
  createEffect(() => {
    if (!initialSpace() && spaceQuery.data) setInitialSpace(spaceQuery.data)
  })

  return (
    <Show
      when={initialSpace()}
      keyed
      fallback={
        <main class='flex min-h-[70vh] items-center justify-center p-4'>
          <div class='bg-card w-full max-w-md rounded-xl border border-border p-6 text-center'>
            <Show
              when={spaceQuery.isError}
              fallback={<p class='text-muted-foreground text-sm'>Loading Space...</p>}
            >
              <h1 class='text-xl font-semibold'>Space unavailable</h1>
              <p class='text-muted-foreground mt-2 text-sm'>
                {spaceQuery.error?.message ?? 'Space could not load.'}
              </p>
              <div class='mt-4 flex justify-center gap-2'>
                <button
                  class='bg-primary text-primary-foreground min-h-11 rounded-md px-4 text-sm font-medium'
                  onClick={() => void spaceQuery.refetch()}
                >
                  Retry
                </button>
                <a
                  href={hrefFor({ kind: 'spaces' })}
                  class='inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium'
                  onClick={(event) => followAppLink(event, hrefFor({ kind: 'spaces' }))}
                >
                  All Spaces
                </a>
              </div>
            </Show>
          </div>
        </main>
      }
    >
      {(space) => (
        <SpaceExperience
          initialSpace={space}
          explicitPresentation={props.presentation}
          transport={transport}
        />
      )}
    </Show>
  )
}
