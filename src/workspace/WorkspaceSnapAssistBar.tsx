import type { AssistGridShape } from '@/lib/workspace-assist-grid'
import type { AssistSlotPick } from '@/lib/workspace-snap-pick'
import { narrowPickToAssistShape } from '@/lib/workspace-snap-pick'
import { Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { WorkspaceSnapAssistMasterGrid } from './WorkspaceSnapAssistMasterGrid'
import { useWorkspacePreferredSnapStore } from '@/lib/workspace-preferred-snap-store'
import { useStoreSync } from '@/src/lib/solid-store-sync'
import { TOP_SNAP_ASSIST_HANDLE_HEIGHT_PX, snapAssistSurfaceWidth } from '@/lib/use-snap-zones'
import { layoutViewportClientSize } from '@/lib/layout-viewport'

function shapeLabel(id: AssistGridShape): string {
  switch (id) {
    case '3x2':
      return '3×2'
    case '3x3':
      return '3×3'
    case '2x2':
      return '2×2'
    case '2x3':
      return '2×3'
  }
}

export type WorkspaceSnapAssistBarProps = {
  visible: boolean
  dragging: boolean
  onHandleEnter: () => void
  onPanelLeave: () => void
  hoverPick: AssistSlotPick | null
  rootRef: (el: HTMLDivElement | undefined) => void
}

export function WorkspaceSnapAssistBar(props: WorkspaceSnapAssistBarProps) {
  const preferredSnapTick = useStoreSync(useWorkspacePreferredSnapStore)
  const assistEnabled = createMemo(() => {
    void preferredSnapTick()
    return useWorkspacePreferredSnapStore.getState().snapAssistOnTopDrag
  })

  const [viewportSize, setViewportSize] = createSignal(layoutViewportClientSize())
  const aspect = createMemo(() => {
    const { w, h } = viewportSize()
    return h > 0 ? w / h : 16 / 9
  })
  const surfaceWidth = createMemo(() => {
    const { w, h } = viewportSize()
    return snapAssistSurfaceWidth(w, h)
  })

  onMount(() => {
    const updateViewport = () => setViewportSize(layoutViewportClientSize())
    const resizeObserver = new ResizeObserver(updateViewport)
    resizeObserver.observe(document.documentElement)
    window.addEventListener('resize', updateViewport)
    onCleanup(() => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateViewport)
    })
  })

  return (
    <Show
      when={props.visible}
      fallback={
        <Show when={props.dragging && assistEnabled()}>
          <div
            data-workspace-snap-assist-handle
            class='fixed left-1/2 top-0 z-[100000] flex -translate-x-1/2 items-center justify-center gap-1 rounded-b-md border border-t-0 border-border/80 bg-popover/95 shadow-lg ring-1 ring-black/10 backdrop-blur-xl'
            style={{
              width: `${surfaceWidth()}px`,
              height: `${TOP_SNAP_ASSIST_HANDLE_HEIGHT_PX}px`,
            }}
            on:pointerenter={props.onHandleEnter}
            on:pointermove={props.onHandleEnter}
            role='button'
            aria-label='Open snap layouts'
          >
            <span class='size-1 rounded-full bg-foreground/40' aria-hidden='true' />
            <span class='size-1 rounded-full bg-foreground/40' aria-hidden='true' />
            <span class='size-1 rounded-full bg-foreground/40' aria-hidden='true' />
          </div>
        </Show>
      }
    >
      <div
        ref={(el) => props.rootRef(el ?? undefined)}
        data-workspace-snap-assist
        class='pointer-events-auto fixed left-1/2 top-0 z-[100000] max-w-[calc(100%-1rem)] -translate-x-1/2 overflow-hidden rounded-b-xl border border-border/80 bg-popover/95 shadow-2xl ring-1 ring-black/10 backdrop-blur-xl'
        style={{ width: `${surfaceWidth()}px` }}
        on:pointerleave={props.onPanelLeave}
      >
        <div class='flex h-8 items-center justify-center gap-1.5 border-b border-border/60 px-3 text-[10px] font-semibold text-foreground/80'>
          Snap layouts
        </div>
        <div
          data-snap-assist-layout-grid
          class={`grid justify-items-center gap-1.5 p-1.5 ${aspect() >= 1 ? 'grid-cols-4' : 'grid-cols-2'}`}
        >
          {/* Not <For>: mapArray reuses rows when `each` is stable, so hoverPick would never update. */}
          <WorkspaceSnapAssistMasterGrid
            shape='3x2'
            getHoverPick={() => narrowPickToAssistShape(props.hoverPick, '3x2')}
            aspectRatio={aspect()}
            layoutLabel={shapeLabel('3x2')}
          />
          <WorkspaceSnapAssistMasterGrid
            shape='3x3'
            getHoverPick={() => narrowPickToAssistShape(props.hoverPick, '3x3')}
            aspectRatio={aspect()}
            layoutLabel={shapeLabel('3x3')}
          />
          <WorkspaceSnapAssistMasterGrid
            shape='2x2'
            getHoverPick={() => narrowPickToAssistShape(props.hoverPick, '2x2')}
            aspectRatio={aspect()}
            layoutLabel={shapeLabel('2x2')}
          />
          <WorkspaceSnapAssistMasterGrid
            shape='2x3'
            getHoverPick={() => narrowPickToAssistShape(props.hoverPick, '2x3')}
            aspectRatio={aspect()}
            layoutLabel={shapeLabel('2x3')}
          />
        </div>
      </div>
    </Show>
  )
}
