import {
  createUrlSearchParamsMemo,
  navigateSearchParams,
  useBrowserHistory,
} from '@/lib/browser/browser-history'
import { DEFAULT_WORKSPACE_SOURCE } from '@/workspace/model/use-workspace'
import { CanvasWorkspace } from './canvas/CanvasWorkspace'
import { For, Match, Switch, createEffect } from 'solid-js'
import { DesktopWorkspace } from './desktop/DesktopWorkspace'
import { buildWorkspaceFromDirParam } from './desktop/workspace-bootstrap'
import { defaultPersistedState } from './shared/workspace-page-persistence'
import { useWorkspaceDocumentChrome } from './shared/use-workspace-document-chrome'
import { useThemeStore } from '@/lib/state/theme-store'
import { useStoreSync } from '@/lib/state/solid-store-sync'
import { WorkspaceSessionProvider, useWorkspaceSession } from './shared/WorkspaceSession'

export function WorkspaceRoute() {
  const history = useBrowserHistory()
  const params = createUrlSearchParamsMemo(history)
  const workspaceId = () => params().get('ws') ?? ''

  return (
    <WorkspaceSessionProvider workspaceId={workspaceId}>
      <WorkspaceRenderer workspaceId={workspaceId} />
    </WorkspaceSessionProvider>
  )
}

function WorkspaceRenderer(props: { workspaceId: () => string }) {
  const session = useWorkspaceSession()
  const history = useBrowserHistory()
  const params = createUrlSearchParamsMemo(history)
  const themeTick = useStoreSync(useThemeStore)
  useWorkspaceDocumentChrome(() => session.registry().records[props.workspaceId()], themeTick)

  createEffect(
    () => ({
      id: props.workspaceId(),
      dir: params().get('dir'),
      ready: session.ready(),
      active: session.active(),
      registry: session.registry(),
    }),
    ({ id, dir, ready, active, registry }) => {
      if (!ready) return
      if (!id) {
        if (dir) {
          navigateSearchParams({ ws: crypto.randomUUID() }, 'replace')
          return
        }
        const last = Object.values(registry.records).sort(
          (left, right) => right.lastOpenedAt - left.lastOpenedAt,
        )[0]
        navigateSearchParams({ ws: last?.id ?? crypto.randomUUID() }, 'replace')
        return
      }
      if (session.deleted(id)) {
        const next = Object.values(registry.records)
          .filter((record) => record.id !== id)
          .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)[0]
        navigateSearchParams({ ws: next?.id ?? crypto.randomUUID() }, 'replace')
        return
      }
      if (active.id === id && active.phase !== 'idle') return
      const record = registry.records[id]
      void session.activate(
        id,
        record?.snapshot ??
          (dir
            ? buildWorkspaceFromDirParam(dir, DEFAULT_WORKSPACE_SOURCE)
            : defaultPersistedState(DEFAULT_WORKSPACE_SOURCE)),
      )
    },
  )

  return (
    <For
      each={session.document() ? [session.active().id] : []}
      fallback={<div class='fixed inset-0 bg-background' />}
    >
      {() => (
        <Switch>
          <Match when={session.document()?.workspaceType === 'canvas'}>
            <CanvasWorkspace />
          </Match>
          <Match when={session.document()}>
            <DesktopWorkspace />
          </Match>
        </Switch>
      )}
    </For>
  )
}
