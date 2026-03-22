import type { FileDragData } from '@/lib/file-drag-data'
import type { PersistedWorkspaceState, WorkspaceWindowDefinition } from '@/lib/use-workspace'
import type { FileIconContext } from '../lib/use-file-icon'
import { createDefaultBounds } from '@/lib/workspace-geometry'
import { WORKSPACE_TITLE_BAR_PX } from '@/lib/workspace-snap-live'
import Maximize2 from 'lucide-solid/icons/maximize-2'
import Minimize2 from 'lucide-solid/icons/minimize-2'
import Minus from 'lucide-solid/icons/minus'
import X from 'lucide-solid/icons/x'
import { type Accessor, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import type { JSX } from 'solid-js'
import {
  type ResizeHandleKey,
  getWorkspaceSnapResizeHandleMap,
} from './workspace-snap-resize-handles'
import type { MergeTarget } from './merge-target'
import { groupIdForWindow } from './tab-group-ops'
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
  fileIconContext: () => FileIconContext
  isActive: boolean
  containerEl: Accessor<HTMLElement | undefined>
  onFocusWindow: (id: string) => void
  onClose: (id: string) => void
  onMinimize: (id: string) => void
  onToggleFullscreen: (id: string) => void
  onOpenLayoutPicker: (windowId: string, rect: DOMRect) => void
  onRestoreDrag: (windowId: string, clientX: number, clientY: number) => WorkspaceBounds | undefined
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
  onTabPullStart?: (groupId: string, tabId: string, e: PointerEvent) => void
  onDropFileToTabBar?: (data: FileDragData, insertIndex?: number) => void
  mergeTargetPreview?: Accessor<MergeTarget | null>
  draggingWindowId?: Accessor<string | null>
  children: JSX.Element
}

function handleEnabled(
  map: Record<ResizeHandleKey, boolean> | 'all',
  key: ResizeHandleKey,
): boolean {
  if (map === 'all') return true
  return map[key] === true
}

/**
 * Drag starts only from `.workspace-window-drag-handle`. Canceled when the event target is inside
 * `.workspace-window-content`, form controls, media, links, `[data-no-window-drag]`, or
 * `.workspace-window-buttons` (mirrors prior react-rnd WindowGroup rules).
 */
function shouldBlockWindowDragStart(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el?.closest) return true
  if (!el.closest('.workspace-window-drag-handle')) return true
  if (el.closest('.workspace-window-content')) return true
  if (el.closest('input, textarea, select, a, audio, video, img')) return true
  if (el.closest('[data-no-window-drag]')) return true
  if (el.closest('.workspace-window-buttons')) return true
  return false
}

export function WorkspaceWindowChrome(props: WorkspaceWindowChromeProps) {
  const [windowGroupEl, setWindowGroupEl] = createSignal<HTMLDivElement | null>(null)
  const [titleBarEl, setTitleBarEl] = createSignal<HTMLDivElement | null>(null)

  createEffect(() => {
    const el = windowGroupEl()
    if (!el) return
    const onMouseDownCapture = (e: MouseEvent) => {
      if (e.button !== 0) return
      const t = e.target as HTMLElement | null
      if (t?.closest?.('.workspace-window-drag-handle')) return
      props.onFocusWindow(props.visibleTabId())
    }
    el.addEventListener('mousedown', onMouseDownCapture, true)
    onCleanup(() => el.removeEventListener('mousedown', onMouseDownCapture, true))
  })

  const liveLeaderId = createMemo(() => {
    const rows = props.workspace()?.windows ?? []
    const leaderWin = rows.find((w) => groupIdForWindow(w) === props.groupId)
    return leaderWin?.id ?? props.leaderWindowId
  })

  const win = createMemo(() => props.workspace()?.windows.find((w) => w.id === liveLeaderId()))
  const hasTabs = createMemo(() => props.tabWindows().length > 1)
  const b = createMemo(
    () => win()?.layout?.bounds ?? createDefaultBounds(0, win()?.type ?? 'browser'),
  )
  const isFullscreen = createMemo(() => win()?.layout?.fullscreen ?? false)
  const isMinimized = createMemo(() => win()?.layout?.minimized ?? false)
  const snapZone = createMemo(() => win()?.layout?.snapZone ?? null)
  const isSnapped = createMemo(() => !!snapZone() && !isFullscreen())

  const resizeMap = createMemo(() => {
    const container = props.containerEl()
    const rect = container?.getBoundingClientRect()
    const canvas = rect ? { width: rect.width, height: rect.height } : null
    return getWorkspaceSnapResizeHandleMap(isSnapped(), snapZone() ?? undefined, b(), canvas)
  })

  const showResize = createMemo(() => !isFullscreen())

  const mergeHighlightInsertIndex = createMemo(() => {
    const p = props.mergeTargetPreview?.()
    if (!p || p.groupId !== props.groupId) return null as number | null
    return p.insertIndex
  })

  const mergeDim = createMemo(
    () => props.draggingWindowId?.() === liveLeaderId() && props.mergeTargetPreview?.() != null,
  )

  const startWindowDrag = (e: PointerEvent, pointerCaptureEl: HTMLElement) => {
    if (shouldBlockWindowDragStart(e.target)) return

    const container = props.containerEl()
    if (!container) return

    const lid = liveLeaderId()
    const wb = props.workspace()?.windows.find((w) => w.id === lid)?.layout?.bounds
    if (!wb) return

    e.preventDefault()
    e.stopPropagation()
    pointerCaptureEl.setPointerCapture(e.pointerId)
    props.onFocusWindow(props.visibleTabId())

    const cRect = container.getBoundingClientRect()

    let grabBase = wb
    if (snapZone() || isFullscreen()) {
      const after = props.onRestoreDrag(lid, e.clientX, e.clientY)
      if (after) grabBase = after
    }
    const grabDx = e.clientX - cRect.left - grabBase.x
    const grabDy = e.clientY - cRect.top - grabBase.y

    const onMove = (ev: PointerEvent) => {
      const id = liveLeaderId()
      props.onDragPointerMove(id, ev.clientX, ev.clientY)
      const cur = props.workspace()?.windows.find((w) => w.id === id)?.layout?.bounds
      if (!cur) return
      let nx = ev.clientX - cRect.left - grabDx
      let ny = ev.clientY - cRect.top - grabDy
      nx = Math.max(0, Math.min(nx, cRect.width - cur.width))
      const maxY = Math.max(0, cRect.height - WORKSPACE_TITLE_BAR_PX)
      ny = Math.max(0, Math.min(ny, maxY))
      props.onDragDuringMove(id, { ...cur, x: nx, y: ny })
    }

    const onUp = (ev: PointerEvent) => {
      pointerCaptureEl.releasePointerCapture(ev.pointerId)
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
      const id = liveLeaderId()
      const final = props.workspace()?.windows.find((w) => w.id === id)?.layout?.bounds
      if (final) {
        props.onDragPointerEnd(id, final, ev.clientX, ev.clientY)
      }
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
  }

  createEffect(() => {
    const bar = titleBarEl()
    if (!bar) return
    const onPointerDownCapture = (e: PointerEvent) => {
      if (e.button !== 0) return
      if (shouldBlockWindowDragStart(e.target)) return
      startWindowDrag(e, bar)
    }
    bar.addEventListener('pointerdown', onPointerDownCapture, true)
    onCleanup(() => bar.removeEventListener('pointerdown', onPointerDownCapture, true))
  })

  const startResize = (direction: string, e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    props.onFocusWindow(props.visibleTabId())

    const container = props.containerEl()
    if (!container) return
    const cRect = container.getBoundingClientRect()

    const startBounds = { ...b() }
    const startX = e.clientX
    const startY = e.clientY

    const applyFreeResize = (nb: WorkspaceBounds) => {
      let next = { ...nb }
      if (next.width < MIN_W) next.width = MIN_W
      if (next.height < MIN_H) next.height = MIN_H
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
      if (next.width > cRect.width) next.x = 0
      else next.x = Math.max(0, Math.min(next.x, cRect.width - next.width))
      const maxY = Math.max(0, cRect.height - WORKSPACE_TITLE_BAR_PX)
      next.y = Math.max(0, Math.min(next.y, maxY))
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

      const id = liveLeaderId()
      const snappedNow = !!props.workspace()?.windows.find((w) => w.id === id)?.layout?.snapZone
      if (snappedNow) {
        props.onResizeSnapped(id, applyFreeResize(nb), direction)
      } else {
        props.onUpdateBounds(id, applyFreeResize(nb))
      }
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const rm = () => resizeMap()

  return (
    <div
      class='absolute flex flex-col'
      style={{
        left: `${b().x}px`,
        top: `${b().y}px`,
        width: isMinimized() ? '1px' : `${b().width}px`,
        height: isMinimized() ? '1px' : `${b().height}px`,
        'z-index': win()?.layout?.zIndex ?? 1,
        ...(isMinimized()
          ? {
              opacity: 0,
              'pointer-events': 'none',
              overflow: 'hidden',
            }
          : mergeDim()
            ? { opacity: 0.55 }
            : {}),
      }}
      aria-hidden={isMinimized()}
    >
      <div
        ref={(el) => setWindowGroupEl(el ?? null)}
        data-window-group={props.groupId}
        data-workspace-window-minimized={isMinimized() ? '' : undefined}
        class={`relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden border border-border bg-background shadow-2xl ${
          props.isActive ? 'border-border shadow-black/20' : ''
        }`}
      >
        <div
          ref={(el) => setTitleBarEl(el ?? null)}
          class={`relative z-10 flex h-8 shrink-0 items-stretch border-b border-border ${
            props.isActive ? 'bg-muted text-foreground' : 'bg-muted/50 text-muted-foreground'
          }`}
        >
          <div
            data-testid='window-drag-handle'
            class='workspace-window-drag-handle flex min-w-0 flex-1 cursor-grab items-center text-xs font-medium select-none active:cursor-grabbing'
          >
            <Show
              when={hasTabs()}
              fallback={
                <WorkspaceSingleTabHeader
                  groupId={props.groupId}
                  tab={props.tabWindows()[0]}
                  isWindowActive={props.isActive}
                  fileIconContext={props.fileIconContext}
                  onDropFile={props.onDropFileToTabBar}
                  mergeHighlightInsertIndex={mergeHighlightInsertIndex}
                />
              }
            >
              <WorkspaceTabStrip
                groupId={props.groupId}
                tabs={props.tabWindows()}
                visibleTabId={props.visibleTabId()}
                isWindowActive={props.isActive}
                fileIconContext={props.fileIconContext}
                onSelectTab={(gid, tid) => props.onSelectTab?.(gid, tid)}
                onFocusWindow={(tid) => props.onFocusWindow(tid)}
                onCloseTab={(tid) => props.onCloseTab?.(tid)}
                onTabPullStart={props.onTabPullStart}
                onDropFile={props.onDropFileToTabBar}
                mergeHighlightInsertIndex={mergeHighlightInsertIndex}
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
            <button
              type='button'
              class='text-muted-foreground hover:bg-muted inline-flex h-full w-8 items-center justify-center'
              onClick={(e) => {
                e.stopPropagation()
                props.onMinimize(liveLeaderId())
              }}
              aria-label='Minimize'
            >
              <Minus class='lucide-minus h-3.5 w-3.5' stroke-width={2} />
            </button>
            <button
              type='button'
              class='text-muted-foreground hover:bg-muted inline-flex h-full w-8 items-center justify-center'
              onClick={(e) => {
                e.stopPropagation()
                props.onToggleFullscreen(liveLeaderId())
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                props.onOpenLayoutPicker(liveLeaderId(), r)
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
              onClick={(e) => {
                e.stopPropagation()
                props.onClose(liveLeaderId())
              }}
              aria-label={`Close ${win()?.title ?? ''}`}
            >
              <X class='lucide-x h-3.5 w-3.5' stroke-width={2} />
            </button>
          </div>
        </div>
        <div
          data-testid='workspace-chrome-content'
          data-no-window-drag
          class='relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-sm text-muted-foreground'
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
              startResize('top', e)
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
              startResize('bottom', e)
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
              startResize('left', e)
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
              startResize('right', e)
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
              startResize('topLeft', e)
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
              startResize('topRight', e)
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
              startResize('bottomLeft', e)
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
              startResize('bottomRight', e)
            }}
          />
        </Show>
      </Show>
    </div>
  )
}
