import { queryKeys } from '@/lib/query-keys'
import { createBrowserSpaceTransport } from '@/lib/space-client'
import { useQuery } from '@tanstack/solid-query'
import { Match, Show, Switch } from 'solid-js'
import { CanvasPage } from '../CanvasPage'
import { followAppLink, hrefFor, navigateSpace } from '../lib/routes'
import { WorkspacePage } from '../WorkspacePage'
import { SpaceRevisionControl } from './SpaceRevisionControl'

export function SpaceRoutePage(props: { spaceId: string }) {
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
  const readySpace = () => (spaceQuery.isFetching ? undefined : spaceQuery.data)

  return (
    <Show
      when={readySpace()}
      fallback={
        <main class='flex min-h-[70vh] items-center justify-center p-4'>
          <div class='bg-card w-full max-w-md rounded-xl border border-border p-6 text-center'>
            <Show
              when={spaceQuery.isError}
              fallback={<p class='text-muted-foreground text-sm'>Loading Space…</p>}
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
        <>
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
                    This Space is deleted. Open revision history to restore a retained version or
                    duplicate one as a new Space.
                  </p>
                  <a
                    href={hrefFor({ kind: 'spaces' })}
                    class='mt-4 inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium'
                    onClick={(event) => followAppLink(event, hrefFor({ kind: 'spaces' }))}
                  >
                    All Spaces
                  </a>
                </div>
              </main>
            }
          >
            <Switch>
              <Match when={space().origin === 'canvas'}>
                <CanvasPage initialSpace={space()} />
              </Match>
              <Match when={space().origin === 'workspace'}>
                <WorkspacePage initialSpace={space()} />
              </Match>
            </Switch>
          </Show>
          <SpaceRevisionControl
            space={space}
            transport={transport}
            onRestored={(restored) => {
              if (restored.id !== props.spaceId) {
                navigateSpace(restored.id)
              } else {
                window.location.reload()
              }
            }}
          />
        </>
      )}
    </Show>
  )
}
