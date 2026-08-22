import type { FileDragData } from '@/lib/files/file-drag-data'
import type { PersistedWorkspaceState } from '@/workspace/model/use-workspace'
import type { WindowDefinition as WorkspaceWindowDefinition } from '@/lib/models/window-model'
import type { FileIconContext } from '@/features/explorer/use-file-icon'
import { createDefaultBounds } from '@/workspace/model/workspace-geometry'
import { WORKSPACE_WINDOW_MIN_VISIBLE_PX } from '@/workspace/model/workspace-geometry'
import { type Accessor, Show, createEffect, createMemo, createSignal } from 'solid-js'
import type { JSX } from '@solidjs/web'
import {
  type ResizeHandleKey,
  getWorkspaceSnapResizeHandleMap,
} from './workspace-snap-resize-handles'
import type { MergeTarget } from './merge-target'
import { groupIdForWindow } from '../../tabs/tab-group-ops'
import { WorkspaceWindowTitlebar } from '@/workspace/shared/WorkspaceWindowTitlebar'
import { useWorkspacePreferredSnapStore } from '@/workspace/model/workspace-preferred-snap-store'
import { useStoreSync } from '@/lib/state/solid-store-sync'
import { applyWorkspaceTileGap } from '@/workspace/model/workspace-tile-gaps'
import { startPointerGesture } from '@/lib/ui/start-pointer-gesture'

const MIN_W = 360
const MIN_H = 260
const WINDOW_DRAG_START_THRESHOLD_PX = 5

export type WorkspaceBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type WorkspacePointerGesture = { commit: () => void; cancel: () => void }

export type WorkspaceWindowChromeProps = {
  window: {
    leaderId: string
    groupId: string
    tabs: Accessor<WorkspaceWindowDefinition[]>
    visibleTabId: Accessor<string>
    workspace: Accessor<PersistedWorkspaceState | null>
    isActive: boolean
  }
  environment: {
    fileIconContext: () => FileIconContext
    container: Accessor<HTMLElement | undefined>
    mergeTarget?: Accessor<MergeTarget | null>
    draggingWindowId?: Accessor<string | null>
  }
  commands: {
    focus: (id: string) => void
    close: (id: string) => void
    minimize: (id: string) => void
    toggleFullscreen: (id: string) => void
    openLayoutPicker: (windowId: string, rect: DOMRect) => void
    restoreDrag: (windowId: string, clientX: number, clientY: number) => WorkspaceBounds | undefined
    moveDrag: (windowId: string, clientX: number, clientY: number) => void
    endDrag: (windowId: string, bounds: WorkspaceBounds, clientX: number, clientY: number) => void
    updateDuringDrag: (windowId: string, bounds: WorkspaceBounds) => void
    resizeSnapped: (windowId: string, bounds: WorkspaceBounds, direction: string) => void
    updateBounds: (windowId: string, bounds: WorkspaceBounds) => void
    beginPointerGesture: () => WorkspacePointerGesture
  }
  tabs: {
    activate?: (groupId: string, tabId: string) => void
    close?: (tabId: string) => void
    togglePinned?: (tabId: string) => void
    pull?: (groupId: string, tabId: string, e: PointerEvent) => void
    dropFile?: (data: FileDragData, groupInsertIndex?: number) => void
    splitLeftId?: Accessor<string | null | undefined>
    exitSplit?: () => void
    useAsSplitLeft?: (tabId: string) => void
  }
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
 *
 * When `allowWindowDragFromLoneTabRow` is true and the group has only one tab, the tab row (not
 * its buttons) is treated like the drag handle so the window can still be moved.
 */
function shouldBlockWindowDragStart(
  target: EventTarget | null,
  allowWindowDragFromLoneTabRow: boolean,
): boolean {
  const el = target as HTMLElement | null
  if (!el?.closest) return true
  if (!el.closest('.workspace-window-drag-handle')) return true
  if (el.closest('.workspace-window-content')) return true
  if (el.closest('input, textarea, select, a, audio, video, img')) return true
  if (
    allowWindowDragFromLoneTabRow &&
    el.closest('[data-workspace-tab-id]') &&
    !el.closest('button')
  ) {
    return false
  }
  if (el.closest('[data-no-window-drag]')) return true
  if (el.closest('.workspace-window-buttons')) return true
  return false
}

export function WorkspaceWindowChrome(props: WorkspaceWindowChromeProps) {
  const [windowGroupEl, setWindowGroupEl] = createSignal<HTMLDivElement | null>(null)
  const [titleBarEl, setTitleBarEl] = createSignal<HTMLDivElement | null>(null)
  const preferredSnapTick = useStoreSync(useWorkspacePreferredSnapStore)

  createEffect(
    () => windowGroupEl(),
    (el) => {
      if (!el) return undefined
      const onMouseDownCapture = (e: MouseEvent) => {
        if (e.button !== 0) return
        const t = e.target as HTMLElement | null
        if (t?.closest?.('.workspace-window-drag-handle')) return
        props.commands.focus(props.window.visibleTabId())
      }
      el.addEventListener('mousedown', onMouseDownCapture, true)
      // eslint-disable-next-line solid/reactivity
      return () => el.removeEventListener('mousedown', onMouseDownCapture, true)
    },
  )

  const liveLeaderId = createMemo(() => {
    const rows = props.window.workspace()?.windows ?? []
    const leaderWin = rows.find((w) => groupIdForWindow(w) === props.window.groupId)
    return leaderWin?.id ?? props.window.leaderId
  })

  const win = createMemo(() =>
    props.window.workspace()?.windows.find((w) => w.id === liveLeaderId()),
  )
  const b = createMemo(
    () => win()?.layout?.bounds ?? createDefaultBounds(0, win()?.type ?? 'browser'),
  )
  const isFullscreen = createMemo(() => win()?.layout?.fullscreen ?? false)
  const isMinimized = createMemo(() => win()?.layout?.minimized ?? false)
  const snapZone = createMemo(() => win()?.layout?.snapZone ?? null)
  const hasTiling = createMemo(() => !!win()?.layout?.tiling)
  const isSnapped = createMemo(() => (hasTiling() || !!snapZone()) && !isFullscreen())
  const isFloating = createMemo(() => !isFullscreen() && !hasTiling() && !snapZone())
  const tiledWindowGap = createMemo(() => {
    void preferredSnapTick()
    return useWorkspacePreferredSnapStore.getState().tiledWindowGap
  })
  const visualBounds = createMemo(() => {
    const container = props.environment.container()
    const rect = container?.getBoundingClientRect()
    return applyWorkspaceTileGap(
      b(),
      rect ? { width: rect.width, height: rect.height } : null,
      tiledWindowGap(),
      isSnapped(),
    )
  })
  const useRoundedTileCorners = createMemo(() => isSnapped() && tiledWindowGap() > 0)

  const resizeMap = createMemo(() => {
    const container = props.environment.container()
    const rect = container?.getBoundingClientRect()
    const canvas = rect ? { width: rect.width, height: rect.height } : null
    return getWorkspaceSnapResizeHandleMap(
      isSnapped(),
      snapZone() ?? undefined,
      b(),
      canvas,
      hasTiling(),
    )
  })

  const showResize = createMemo(() => !isFullscreen())

  const mergeHighlightInsertIndex = createMemo(() => {
    const p = props.environment.mergeTarget?.()
    if (!p || p.groupId !== props.window.groupId) return null as number | null
    return p.insertIndex
  })

  const mergeDim = createMemo(
    () =>
      props.environment.draggingWindowId?.() === liveLeaderId() &&
      props.environment.mergeTarget?.() != null,
  )

  const loneTabStripDrag = createMemo(
    () =>
      (props.window
        .workspace()
        ?.windows.filter((window) => groupIdForWindow(window) === props.window.groupId).length ??
        props.window.tabs().length) <= 1,
  )

  const startWindowDrag = (e: PointerEvent, pointerCaptureEl: HTMLElement) => {
    if (shouldBlockWindowDragStart(e.target, loneTabStripDrag())) return

    const container = props.environment.container()
    if (!container) return

    const lid = liveLeaderId()
    const initialWorkspace = props.window.workspace()
    if (!initialWorkspace) return
    const wb = initialWorkspace.windows.find((w) => w.id === lid)?.layout?.bounds
    if (!wb) return
    const pointerGesture = props.commands.beginPointerGesture()

    e.preventDefault()
    e.stopPropagation()
    props.commands.focus(props.window.visibleTabId())

    const cRect = container.getBoundingClientRect()

    let grabBase = wb
    let grabDx = e.clientX - cRect.left - grabBase.x
    let grabDy = e.clientY - cRect.top - grabBase.y
    let dragStarted = isFloating()
    const pointerDownX = e.clientX
    const pointerDownY = e.clientY
    let liveBounds: WorkspaceBounds = { ...grabBase }

    const onMove = (ev: PointerEvent) => {
      if (!dragStarted) {
        if (
          Math.hypot(ev.clientX - pointerDownX, ev.clientY - pointerDownY) <
          WINDOW_DRAG_START_THRESHOLD_PX
        ) {
          return
        }
        const after = props.commands.restoreDrag(lid, pointerDownX, pointerDownY)
        if (after) {
          grabBase = after
          liveBounds = { ...after }
          grabDx = pointerDownX - cRect.left - after.x
          grabDy = pointerDownY - cRect.top - after.y
        }
        dragStarted = true
      }
      const id = liveLeaderId()
      props.commands.moveDrag(id, ev.clientX, ev.clientY)
      const cur = liveBounds
      let nx = ev.clientX - cRect.left - grabDx
      let ny = ev.clientY - cRect.top - grabDy
      const vis = WORKSPACE_WINDOW_MIN_VISIBLE_PX
      const minX = vis - cur.width
      const maxX = cRect.width - vis
      nx = Math.max(minX, Math.min(nx, maxX))
      const minY = vis - cur.height
      const maxY = cRect.height - vis
      ny = Math.max(minY, Math.min(ny, maxY))
      liveBounds = { ...cur, x: nx, y: ny }
      props.commands.updateDuringDrag(id, liveBounds)
    }

    startPointerGesture({
      pointerId: e.pointerId,
      captureTarget: pointerCaptureEl,
      move: onMove,
      commit: (ev) => {
        if (dragStarted) {
          const id = liveLeaderId()
          props.commands.endDrag(id, liveBounds, ev.clientX, ev.clientY)
        }
        pointerGesture.commit()
      },
      cancel: pointerGesture.cancel,
    })
  }

  createEffect(
    () => titleBarEl(),
    (bar) => {
      if (!bar) return undefined
      const onPointerDownCapture = (e: PointerEvent) => {
        if (e.button !== 0) return
        startWindowDrag(e, bar)
      }
      bar.addEventListener('pointerdown', onPointerDownCapture, true)
      // eslint-disable-next-line solid/reactivity
      return () => bar.removeEventListener('pointerdown', onPointerDownCapture, true)
    },
  )

  const startResize = (direction: string, e: PointerEvent) => {
    const container = props.environment.container()
    if (!container) return
    const initialWorkspace = props.window.workspace()
    if (!initialWorkspace) return
    const pointerGesture = props.commands.beginPointerGesture()

    e.preventDefault()
    e.stopPropagation()
    props.commands.focus(props.window.visibleTabId())

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
      const vis = WORKSPACE_WINDOW_MIN_VISIBLE_PX
      next.y = Math.max(vis - next.height, Math.min(next.y, cRect.height - vis))
      return next
    }

    const onMove = (ev: PointerEvent) => {
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
      if (isSnapped()) {
        props.commands.resizeSnapped(id, applyFreeResize(nb), direction)
      } else {
        props.commands.updateBounds(id, applyFreeResize(nb))
      }
    }

    startPointerGesture({
      pointerId: e.pointerId,
      captureTarget: e.currentTarget as HTMLElement,
      move: onMove,
      commit: pointerGesture.commit,
      cancel: pointerGesture.cancel,
    })
  }

  const rm = () => resizeMap()
  const keyboardResize = (direction: 'top' | 'bottom' | 'left' | 'right', e: KeyboardEvent) => {
    const delta = e.shiftKey ? 32 : 8
    let nb = { ...b() }
    if (direction === 'left' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const dx = e.key === 'ArrowLeft' ? -delta : delta
      nb = { ...nb, x: nb.x + dx, width: nb.width - dx }
    } else if (direction === 'right' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      nb = {
        ...nb,
        width: nb.width + (e.key === 'ArrowRight' ? delta : -delta),
      }
    } else if (direction === 'top' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const dy = e.key === 'ArrowUp' ? -delta : delta
      nb = { ...nb, y: nb.y + dy, height: nb.height - dy }
    } else if (direction === 'bottom' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      nb = {
        ...nb,
        height: nb.height + (e.key === 'ArrowDown' ? delta : -delta),
      }
    } else return
    e.preventDefault()
    if (isSnapped()) props.commands.resizeSnapped(liveLeaderId(), nb, direction)
    else props.commands.updateBounds(liveLeaderId(), nb)
  }

  return (
    <div
      class='absolute flex flex-col'
      style={{
        left: `${visualBounds().x}px`,
        top: `${visualBounds().y}px`,
        width: isMinimized() ? '1px' : `${visualBounds().width}px`,
        height: isMinimized() ? '1px' : `${visualBounds().height}px`,
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
      aria-hidden={isMinimized() ? 'true' : 'false'}
    >
      <div
        ref={(el) => setWindowGroupEl(el ?? null)}
        data-window-group={props.window.groupId}
        data-workspace-window-snapped={isSnapped() ? '' : undefined}
        data-workspace-window-minimized={isMinimized() ? '' : undefined}
        class={`relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden border border-border bg-background shadow-2xl ${
          isFloating() || useRoundedTileCorners()
            ? 'rounded-lg outline outline-1 -outline-offset-1 outline-border'
            : 'rounded-none'
        } ${props.window.isActive ? 'border-border shadow-black/20' : ''}`}
      >
        <WorkspaceWindowTitlebar
          groupId={props.window.groupId}
          tabs={props.window.tabs}
          visibleTabId={props.window.visibleTabId}
          active={props.window.isActive}
          fileIconContext={props.environment.fileIconContext}
          maximized={isFullscreen}
          onRoot={(element) => setTitleBarEl(element)}
          testId='window-drag-handle'
          mergeHighlightInsertIndex={mergeHighlightInsertIndex}
          splitLeftTabId={props.tabs.splitLeftId}
          onActivateTab={props.tabs.activate}
          onFocusWindow={props.commands.focus}
          onCloseTab={props.tabs.close}
          onToggleTabPinned={props.tabs.togglePinned}
          onTabPullStart={props.tabs.pull}
          onDropFile={props.tabs.dropFile}
          onExitSplitView={props.tabs.exitSplit}
          onUseAsSplitLeftTab={props.tabs.useAsSplitLeft}
          onMinimize={() => props.commands.minimize(liveLeaderId())}
          onToggleMaximize={() => props.commands.toggleFullscreen(liveLeaderId())}
          onOpenLayoutPicker={(rect) => props.commands.openLayoutPicker(liveLeaderId(), rect)}
          onClose={() => props.commands.close(liveLeaderId())}
        />
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
            role='separator'
            aria-label='Resize top edge'
            tabindex={0}
            class='pointer-events-auto absolute top-0 right-2 left-2 z-[100] h-2'
            style={{ cursor: 'row-resize' }}
            onPointerDown={(e) => {
              e.stopPropagation()
              startResize('top', e)
            }}
            onKeyDown={(e) => keyboardResize('top', e)}
          />
        </Show>
        <Show
          when={rm() === 'all' || handleEnabled(rm() as Record<ResizeHandleKey, boolean>, 'bottom')}
        >
          <div
            data-workspace-resize-handle
            role='separator'
            aria-label='Resize bottom edge'
            tabindex={0}
            class='pointer-events-auto absolute right-2 bottom-0 left-2 z-[100] h-2'
            style={{ cursor: 'row-resize' }}
            onPointerDown={(e) => {
              e.stopPropagation()
              startResize('bottom', e)
            }}
            onKeyDown={(e) => keyboardResize('bottom', e)}
          />
        </Show>
        <Show
          when={rm() === 'all' || handleEnabled(rm() as Record<ResizeHandleKey, boolean>, 'left')}
        >
          <div
            data-workspace-resize-handle
            role='separator'
            aria-label='Resize left edge'
            tabindex={0}
            class='pointer-events-auto absolute top-2 bottom-2 left-0 z-[100] w-2'
            style={{ cursor: 'col-resize' }}
            onPointerDown={(e) => {
              e.stopPropagation()
              startResize('left', e)
            }}
            onKeyDown={(e) => keyboardResize('left', e)}
          />
        </Show>
        <Show
          when={rm() === 'all' || handleEnabled(rm() as Record<ResizeHandleKey, boolean>, 'right')}
        >
          <div
            data-workspace-resize-handle
            role='separator'
            aria-label='Resize right edge'
            tabindex={0}
            class='pointer-events-auto absolute top-2 right-0 bottom-2 z-[100] w-2'
            style={{ cursor: 'col-resize' }}
            onPointerDown={(e) => {
              e.stopPropagation()
              startResize('right', e)
            }}
            onKeyDown={(e) => keyboardResize('right', e)}
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
            onPointerDown={(e) => {
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
            onPointerDown={(e) => {
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
            onPointerDown={(e) => {
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
            onPointerDown={(e) => {
              e.stopPropagation()
              startResize('bottomRight', e)
            }}
          />
        </Show>
      </Show>
    </div>
  )
}
