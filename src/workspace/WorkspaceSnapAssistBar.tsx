import type { AssistGridShape } from '@/lib/workspace-assist-grid'
import type { AssistSlotPick } from '@/lib/workspace-snap-pick'
import { narrowPickToAssistShape } from '@/lib/workspace-snap-pick'
import { Show, createMemo } from 'solid-js'
import { WorkspaceSnapAssistMasterGrid } from './WorkspaceSnapAssistMasterGrid'

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
  container: HTMLElement
  visible: boolean
  hoverPick: AssistSlotPick | null
  rootRef: (el: HTMLDivElement | undefined) => void
}

export function WorkspaceSnapAssistBar(props: WorkspaceSnapAssistBarProps) {
  const aspect = createMemo(() => {
    const rect = props.container.getBoundingClientRect()
    return rect.height > 0 ? rect.width / rect.height : 16 / 12
  })

  return (
    <Show when={props.visible}>
      <div
        ref={(el) => props.rootRef(el ?? undefined)}
        data-workspace-snap-assist
        class='pointer-events-auto absolute left-1/2 top-2 z-[100000] max-w-[calc(100%-1rem)] -translate-x-1/2 rounded-lg border border-border bg-popover/95 p-2 shadow-2xl backdrop-blur'
      >
        <div class='mb-1 text-center text-[10px] font-medium tracking-wider text-muted-foreground uppercase'>
          Snap layouts
        </div>
        <div class='flex max-w-[min(100vw-1rem,32rem)] justify-center gap-1.5 overflow-x-auto sm:gap-2'>
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
