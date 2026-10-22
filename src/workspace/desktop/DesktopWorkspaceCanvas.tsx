import { view, list, collection, domBinding } from 'effectweb'
import type { AssistGridSpan } from '@/workspace/model/workspace-assist-grid'
import { WorkspaceSnapAssistBar } from '@/workspace/desktop/layout/WorkspaceSnapAssistBar'
import { WorkspaceTilingPicker } from '@/workspace/desktop/layout/WorkspaceTilingPicker'
import type { WorkspaceSnapDragModel } from '@/workspace/desktop/layout/create-workspace-snap-drag-model'
import { DesktopWindowGroup } from './DesktopWindowGroup'
import type { DesktopWindowGroupModel, DesktopSnapActions } from './desktop-window-groups'
export type DesktopWorkspaceCanvasProps = {
  groups: readonly DesktopWindowGroupModel[]
  empty: { hasWindows: () => boolean; openBrowser: () => void }
  snap: {
    model: ReturnType<WorkspaceSnapDragModel['source']['model']> & { actions: DesktopSnapActions }
  }
  picker: {
    state: () => { windowId: string; anchor: DOMRect } | null
    close: () => void
    pick: (windowId: string, span: AssistGridSpan) => void
    setHover: (span: AssistGridSpan | null) => void
  }
}
export const DesktopWorkspaceCanvas = view<DesktopWorkspaceCanvasProps>((props) => {
  const snap = () => props.snap.model
  return props.empty.hasWindows() ? (
    <>
      <div
        use={{
          ...domBinding(snap().actions.bindSnapPreview, previewBinding),
          identity: snap().actions.bindSnapPreview,
        }}
        data-snap-preview
        class='pointer-events-none absolute border-2 border-blue-400/50 bg-blue-500/15 transition-all duration-150'
      />
      {((_area) =>
        _area ? (
          <WorkspaceSnapAssistBar
            visible={snap().snapAssistShown}
            dragging={snap().dragSnapWindowId != null}
            onHandleEnter={snap().actions.engageSnapAssistFromHandle}
            onPanelLeave={snap().actions.disengageSnapAssistFromPanel}
            hoverPick={snap().assistHoverPick}
            rootRef={snap().actions.bindSnapAssistRoot}
          />
        ) : null)(snap().workspaceAreaNode)}
      {list(desktopGroups.from(props.groups), (group) => (
        <DesktopWindowGroup {...group} />
      ))}
      {((p) => {
        if (!p) return null

        const c = snap().workspaceAreaNode
        if (!c) return null
        return (
          <WorkspaceTilingPicker
            anchorRect={p.anchor}
            container={c}
            onSelectSpan={(span) => props.picker.pick(p.windowId, span)}
            onClose={props.picker.close}
            onHoverSpanChange={props.picker.setHover}
          />
        )
      })(props.picker.state())}
    </>
  ) : (
    <div class='flex h-full items-center justify-center p-6'>
      <div class='w-full max-w-md rounded-xl border border-border bg-card/95 p-8 text-center shadow-2xl backdrop-blur'>
        <div class='space-y-3'>
          <div class='text-lg font-medium'>No windows are open</div>
          <div class='text-sm text-muted-foreground'>
            Start a browser window to build your workspace.
          </div>
          <button
            type='button'
            class='inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90'
            onClick={props.empty.openBrowser}
          >
            Open Browser
          </button>
        </div>
      </div>
    </div>
  )
})

const previewBinding = (
  element: HTMLDivElement,
  current: () => (element: HTMLDivElement | null) => void,
) => {
  element.style.display = 'none'
  element.style.zIndex = '9000'
  current()(element)
  return () => current()(null)
}

const desktopGroups = collection<DesktopWindowGroupModel>((group) => group.groupId)
