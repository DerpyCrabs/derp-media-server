import { randomId } from '@/lib/random-id'
import { browserHistory, navigateSearchParams } from '@/lib/browser/browser-history'
import { DEFAULT_WORKSPACE_SOURCE } from '@/workspace/model/workspace'
import { CanvasWorkspace } from './canvas/CanvasWorkspace'
import { view, modelOwner, list, collection, controllerView } from 'effectweb'
import { Effect } from 'effect'
import { DesktopWorkspace } from './desktop/DesktopWorkspace'
import { buildWorkspaceFromDirParam } from './desktop/workspace-bootstrap'
import { defaultPersistedState } from './shared/workspace-page-persistence'
import { createWorkspaceDocumentChrome } from './shared/workspace-document-chrome'
import { themeStore } from '@/lib/state/theme-store'
import { createWorkspaceSession } from './shared/WorkspaceSession'
import {
  createLinkedWorkspaceSnapshot,
  parseWorkspaceCreationLink,
} from './model/workspace-creation-link'
function routeController() {
  const params = () => new URLSearchParams(browserHistory.model().search)
  const workspaceId = () => params().get('ws') ?? ''
  const session = createWorkspaceSession(workspaceId)
  const chrome = createWorkspaceDocumentChrome()
  const owner = modelOwner({ session, id: '', type: '' })
  const slot = 'activate-workspace'
  const synchronize = () => {
    const id = workspaceId()
    const registry = session.catalog.value()
    const creation = parseWorkspaceCreationLink(params())
    const dir = params().get('dir')
    const record = registry.records[id]
    const records = Object.values(registry.records).sort(
      (left, right) => right.lastOpenedAt - left.lastOpenedAt,
    )
    chrome.update(record)
    const active = session.state.active()
    const document = session.document.value()
    owner.patch({ id: document ? active.id : '', type: document?.workspaceType ?? '' })
    if (!session.state.ready()) return
    if (!id) {
      navigateSearchParams({ ws: dir ? randomId() : (records[0]?.id ?? randomId()) }, 'replace')
      return
    }
    if (session.state.deleted(id)) {
      navigateSearchParams(
        { ws: records.find((record) => record.id !== id)?.id ?? randomId() },
        'replace',
      )
      return
    }
    if (creation && record) {
      navigateSearchParams({ new: null, name: null }, 'replace')
      return
    }
    if (active.id === id && active.phase !== 'idle') return
    owner.run(
      slot,
      session.lifecycle
        .activate(
          id,
          record?.snapshot ??
            (creation
              ? createLinkedWorkspaceSnapshot(creation.type)
              : dir
                ? buildWorkspaceFromDirParam(dir, DEFAULT_WORKSPACE_SOURCE)
                : defaultPersistedState(DEFAULT_WORKSPACE_SOURCE)),
          false,
          !record && creation?.name ? { name: creation.name } : undefined,
        )
        .pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              if (creation && result && workspaceId() === id)
                navigateSearchParams({ new: null, name: null }, 'replace')
            }),
          ),
        ),
      'replace',
    )
  }
  const stops = [
    browserHistory.subscribe(synchronize),
    session.source.subscribe(synchronize),
    themeStore.source.subscribe(synchronize),
  ]
  synchronize()
  return {
    source: owner.source,
    lifetime: {
      close: () =>
        Effect.sync(() => {
          stops.forEach((stop) => stop())
          chrome.dispose()
        }).pipe(Effect.andThen(session.close()), Effect.ensuring(owner.close().pipe(Effect.orDie))),
      dispose() {
        stops.forEach((stop) => stop())
        chrome.dispose()
        session.dispose()
        owner.dispose()
      },
    },
  }
}
const routeIds = collection<string>((id) => id)
export const WorkspaceRoute = controllerView(
  { controller: routeController },
  view((model) =>
    model.id ? (
      list(routeIds.from([model.id]), () =>
        model.type === 'canvas' ? (
          <CanvasWorkspace session={model.session} />
        ) : (
          <DesktopWorkspace session={model.session} />
        ),
      )
    ) : (
      <div class='fixed inset-0 bg-background' />
    ),
  ),
)
