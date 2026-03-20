import type { FileDragData } from '@/lib/file-drag-data'
import type { PersistedWorkspaceState, WorkspaceWindowDefinition } from '@/lib/use-workspace'
import { createDefaultBounds } from '@/lib/workspace-geometry'
import Maximize2 from 'lucide-solid/icons/maximize-2'
import Minimize2 from 'lucide-solid/icons/minimize-2'
import Minus from 'lucide-solid/icons/minus'
import Plus from 'lucide-solid/icons/plus'
import X from 'lucide-solid/icons/x'
import { type Accessor, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import type { JSX } from 'solid-js'
import {
  type ResizeHandleKey,
  getWorkspaceSnapResizeHandleMap,
} from './workspace-snap-resize-handles'
import { WorkspaceSingleTabHeader, WorkspaceTabStrip } from './WorkspaceTabStrip'

const MIN_W = 360
const MIN_H = 260

export type WorkspaceBounds = { x: number; y: number; width: number; height: number }

export type WorkspaceWindowChromeProps = {
  leaderWindowId: string
  groupId: string
  tabWindows: Accessor<WorkspaceWindowDefinition[]>
  visibleTabId: Accessor<string>
  workspace: Accessor<PersistedWorkspaceState | null>
  isActive: boolean
  containerEl: Accessor<HTMLElement | undefined>
  onFocusWindow: (id: string) => void
  onClose: (id: string) => void
  onMinimize: (id: string) => void
  onToggleFullscreen: (id: string) => void
  onOpenLayoutPicker: (windowId: string, rect: DOMRect) => void
  onRestoreDrag: (windowId: string, clientX: number, clientY: number) => void
  onDragPointerMove: (windowId: string, clientX: number, clientY: number) => void
  onDragPointerEnd: (
    windowId: string,
    bounds: WorkspaceBounds,
    clientX: number,
    clientY: number,
  ) => void
  onDragDuringMove: (windowId: string, bounds: WorkspaceBounds) => void
  onResizeSnapped: (windowId: string, bounds: WorkspaceBounds, direction: string) => void
  onUpdateBounds: (windowId: string, bounds: WorkspaceBounds) => void
  onSelectTab?: (groupId: string, tabId: string) => void
  onCloseTab?: (tabId: string) => void
  onDetachTab?: (tabId: string, clientX: number, clientY: number) => void
  onAddTab?: () => void
  onDropFileToTabBar?: (data: FileDragData, insertIndex?: number) => void
  children: JSX.Element
}

function handleEnabled(
  map: Record<ResizeHandleKey, boolean> | 'all',
  key: ResizeHandleKey,
): boolean {
  if (map === 'all') return true
  return map[key] === true
}

export function WorkspaceWindowChrome(props: WorkspaceWindowChromeProps) {
  const [windowGroupEl, setWindowGroupEl] = createSignal<HTMLDivElement | null>(null)

  createEffect(() => {
    const el = windowGroupEl()
    if (!el) return
    const onMouseDownCapture = () => {
      props.onFocusWindow(props.visibleTabId())
    }
    el.addEventListener('mousedown', onMouseDownCapture, true)
    onCleanup(() => el.removeEventListener('mousedown', onMouseDownCapture, true))
  })

  const win = createMemo(() =>
    props.workspace()?.windows.find((w) => w.id === props.leaderWindowId),
  )
  const hasTabs = createMemo(() => props.tabWindows().length > 1)
  const b = createMemo(
    () => win()?.layout?.bounds ?? createDefaultBounds(0, win()?.type ?? 'browser'),
  )
  const isFullscreen = createMemo(() => win()?.layout?.fullscreen ?? false)
  const snapZone = createMemo(() => win()?.layout?.snapZone ?? null)
  const isSnapped = createMemo(() => !!snapZone() && !isFullscreen())

  const resizeMap = createMemo(() =>
    getWorkspaceSnapResizeHandleMap(isSnapped(), snapZone() ?? undefined),
  )

  const showResize = createMemo(() => !isFullscreen())

  const startWindowDrag = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-no-window-drag]')) return
    e.preventDefault()
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    props.onFocusWindow(props.visibleTabId())

    const container = props.containerEl()
    if (!container) return
    const cRect = container.getBoundingClientRect()

    if (snapZone() || isFullscreen()) {
      props.onRestoreDrag(props.leaderWindowId, e.clientX, e.clientY)
    }

    const wb = props.workspace()?.windows.find((w) => w.id === props.leaderWindowId)?.layout?.bounds
    if (!wb) return
    const grabDx = e.clientX - cRect.left - wb.x
    const grabDy = e.clientY - cRect.top - wb.y

    const onMove = (ev: PointerEvent) => {
      props.onDragPointerMove(props.leaderWindowId, ev.clientX, ev.clientY)
      const cur = props.workspace()?.windows.find((w) => w.id === props.leaderWindowId)
        ?.layout?.bounds
      if (!cur) return
      let nx = ev.clientX - cRect.left - grabDx
      let ny = ev.clientY - cRect.top - grabDy
      nx = Math.max(0, Math.min(nx, cRect.width - cur.width))
      ny = Math.max(0, Math.min(ny, cRect.height - cur.height))
      props.onDragDuringMove(props.leaderWindowId, { ...cur, x: nx, y: ny })
    }

    const onUp = (ev: PointerEvent) => {
      el.releasePointerCapture(ev.pointerId)
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      const final = props.workspace()?.windows.find((w) => w.id === props.leaderWindowId)
        ?.layout?.bounds
      if (final) {
        props.onDragPointerEnd(props.leaderWindowId, final, ev.clientX, ev.clientY)
      }
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }

  const startResize = (direction: string) => (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    props.onFocusWindow(props.visibleTabId())

    const container = props.containerEl()
    if (!container) return
    const cRect = container.getBoundingClientRect()

    const startBounds = { ...b() }
    const startX = e.clientX
    const startY = e.clientY
    const snapped = isSnapped()

    const applyFreeResize = (nb: WorkspaceBounds) => {
      let next = { ...nb }
      if (next.width < MIN_W) next.width = MIN_W
      if (next.height < MIN_H) next.height = MIN_H
      if (next.x + next.width > cRect.width) next.x = Math.max(0, cRect.width - next.width)
      if (next.y + next.height > cRect.height) next.y = Math.max(0, cRect.height - next.height)
      if (next.x < 0) {
        next.width += next.x
        next.x = 0
      }
      if (next.y < 0) {
        next.height += next.y
        next.y = 0
      }
      if (next.width < MIN_W) next.width = MIN_W
      if (next.height < MIN_H) next.height = MIN_H
      return next
    }

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      let nb: WorkspaceBounds = { ...startBounds }

      if (direction.includes('right')) nb.width = startBounds.width + dx
      if (direction.includes('left')) {
        nb.x = startBounds.x + dx
        nb.width = startBounds.width - dx
      }
      if (direction.includes('bottom')) nb.height = startBounds.height + dy
      if (direction.includes('top')) {
        nb.y = startBounds.y + dy
        nb.height = startBounds.height - dy
      }

      if (snapped) {
        props.onResizeSnapped(props.leaderWindowId, applyFreeResize(nb), direction)
      } else {
        props.onUpdateBounds(props.leaderWindowId, applyFreeResize(nb))
      }
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const guardClick = (fn: () => void, e: MouseEvent) => {
    e.stopPropagation()
    fn()
  }

  const rm = () => resizeMap()

  return (
    <div
      class='absolute flex flex-col'
      style={{
        left: `${b().x}px`,
        top: `${b().y}px`,
        width: `${b().width}px`,
        height: `${b().height}px`,
        'z-index': win()?.layout?.zIndex ?? 1,
      }}
    >
      <div
        ref={(el) => setWindowGroupEl(el ?? null)}
        data-window-group={props.groupId}
        class={`relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border bg-card shadow-md ${
          props.isActive ? 'border-border shadow-black/20' : 'border-border'
        }`}
      >
        <div
          class={`relative z-10 flex h-8 shrink-0 items-stretch border-b border-border ${
            props.isActive ? 'bg-muted text-foreground' : 'bg-muted/50 text-muted-foreground'
          }`}
        >
          <div
            data-testid='window-drag-handle'
            class='flex min-w-0 flex-1 cursor-grab items-center text-xs font-medium select-none active:cursor-grabbing'
            onPointerDown={startWindowDrag}
          >
            <Show
              when={hasTabs()}
              fallback={
                <WorkspaceSingleTabHeader
                  groupId={props.groupId}
                  tab={props.tabWindows()[0]}
                  isWindowActive={props.isActive}
                  onDropFile={props.onDropFileToTabBar}
                />
              }
            >
              <WorkspaceTabStrip
                groupId={props.groupId}
                tabs={props.tabWindows()}
                visibleTabId={props.visibleTabId()}
                isWindowActive={props.isActive}
                onSelectTab={(gid, tid) => props.onSelectTab?.(gid, tid)}
                onFocusWindow={(tid) => props.onFocusWindow(tid)}
                onCloseTab={(tid) => props.onCloseTab?.(tid)}
                onDetachTab={props.onDetachTab}
                onDropFile={props.onDropFileToTabBar}
              />
            </Show>
          </div>
          <div
            class='workspace-window-drag-handle min-w-[48px] shrink-0 cursor-grab active:cursor-grabbing'
            aria-hidden
          />
          <div
            data-no-window-drag
            class='workspace-window-buttons flex shrink-0 items-stretch'
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Show when={props.onAddTab}>
              <button
                type='button'
                data-no-window-drag
                class='text-muted-foreground hover:bg-muted inline-flex h-full w-8 items-center justify-center'
                onClick={(e) => guardClick(() => props.onAddTab?.(), e)}
                aria-label='New tab'
              >
                <Plus class='lucide-plus h-3.5 w-3.5' stroke-width={2} />
              </button>
            </Show>
            <button
              type='button'
              class='text-muted-foreground hover:bg-muted inline-flex h-full w-8 items-center justify-center'
              onClick={(e) => guardClick(() => props.onMinimize(props.leaderWindowId), e)}
              aria-label='Minimize'
            >
              <Minus class='lucide-minus h-3.5 w-3.5' stroke-width={2} />
            </button>
            <button
              type='button'
              class='text-muted-foreground hover:bg-muted inline-flex h-full w-8 items-center justify-center'
              onClick={(e) => guardClick(() => props.onToggleFullscreen(props.leaderWindowId), e)}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                props.onOpenLayoutPicker(props.leaderWindowId, r)
              }}
              aria-label='Maximize'
            >
              <Show
                when={isFullscreen()}
                fallback={<Maximize2 class='lucide-maximize-2 h-3.5 w-3.5' stroke-width={2} />}
              >
                <Minimize2 class='lucide-minimize-2 h-3.5 w-3.5' stroke-width={2} />
              </Show>
            </button>
            <button
              type='button'
              class='text-muted-foreground hover:bg-muted inline-flex h-full w-8 items-center justify-center'
              onClick={(e) => guardClick(() => props.onClose(props.leaderWindowId), e)}
              aria-label={`Close ${win()?.title ?? ''}`}
            >
              <X class='lucide-x h-3.5 w-3.5' stroke-width={2} />
            </button>
          </div>
        </div>
        <div
          data-testid='workspace-chrome-content'
          class='workspace-window-content min-h-0 flex-1 overflow-hidden text-sm text-muted-foreground'
        >
          {props.children}
        </div>
      </div>

      <Show when={showResize()}>
        <Show
          when={rm() === 'all' || handleEnabled(rm() as Record<ResizeHandleKey, boolean>, 'top')}
        >
          <div
            data-workspace-resize-handle
            class='pointer-events-auto absolute top-0 right-2 left-2 z-[100] h-2'
            style={{ cursor: 'row-resize' }}
            onMouseDown={(e) => {
              e.stopPropagation()
              startResize('top')(e)
            }}
          />
        </Show>
        <Show
          when={rm() === 'all' || handleEnabled(rm() as Record<ResizeHandleKey, boolean>, 'bottom')}
        >
          <div
            data-workspace-resize-handle
            class='pointer-events-auto absolute right-2 bottom-0 left-2 z-[100] h-2'
            style={{ cursor: 'row-resize' }}
            onMouseDown={(e) => {
              e.stopPropagation()
              startResize('bottom')(e)
            }}
          />
        </Show>
        <Show
          when={rm() === 'all' || handleEnabled(rm() as Record<ResizeHandleKey, boolean>, 'left')}
        >
          <div
            data-workspace-resize-handle
            class='pointer-events-auto absolute top-2 bottom-2 left-0 z-[100] w-2'
            style={{ cursor: 'col-resize' }}
            onMouseDown={(e) => {
              e.stopPropagation()
              startResize('left')(e)
            }}
          />
        </Show>
        <Show
          when={rm() === 'all' || handleEnabled(rm() as Record<ResizeHandleKey, boolean>, 'right')}
        >
          <div
            data-workspace-resize-handle
            class='pointer-events-auto absolute top-2 right-0 bottom-2 z-[100] w-2'
            style={{ cursor: 'col-resize' }}
            onMouseDown={(e) => {
              e.stopPropagation()
              startResize('right')(e)
            }}
          />
        </Show>
        <Show
          when={
            rm() === 'all' || handleEnabled(rm() as Record<ResizeHandleKey, boolean>, 'topLeft')
          }
        >
          <div
            data-workspace-resize-handle
            class='pointer-events-auto absolute top-0 left-0 z-[110] h-4 w-4'
            style={{ cursor: 'nwse-resize' }}
            onMouseDown={(e) => {
              e.stopPropagation()
              startResize('topLeft')(e)
            }}
          />
        </Show>
        <Show
          when={
            rm() === 'all' || handleEnabled(rm() as Record<ResizeHandleKey, boolean>, 'topRight')
          }
        >
          <div
            data-workspace-resize-handle
            class='pointer-events-auto absolute top-0 right-0 z-[110] h-4 w-4'
            style={{ cursor: 'nesw-resize' }}
            onMouseDown={(e) => {
              e.stopPropagation()
              startResize('topRight')(e)
            }}
          />
        </Show>
        <Show
          when={
            rm() === 'all' || handleEnabled(rm() as Record<ResizeHandleKey, boolean>, 'bottomLeft')
          }
        >
          <div
            data-workspace-resize-handle
            class='pointer-events-auto absolute bottom-0 left-0 z-[110] h-4 w-4'
            style={{ cursor: 'nesw-resize' }}
            onMouseDown={(e) => {
              e.stopPropagation()
              startResize('bottomLeft')(e)
            }}
          />
        </Show>
        <Show
          when={
            rm() === 'all' || handleEnabled(rm() as Record<ResizeHandleKey, boolean>, 'bottomRight')
          }
        >
          <div
            data-workspace-resize-handle
            class='pointer-events-auto absolute right-0 bottom-0 z-[110] h-4 w-4'
            style={{ cursor: 'nwse-resize' }}
            onMouseDown={(e) => {
              e.stopPropagation()
              startResize('bottomRight')(e)
            }}
          />
        </Show>
      </Show>
    </div>
  )
}
