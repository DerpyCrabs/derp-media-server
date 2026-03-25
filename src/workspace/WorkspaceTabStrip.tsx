import type { FileDragData } from '@/lib/file-drag-data'
import { getFileDragData, hasFileDragData } from '@/lib/file-drag-data'
import type { WorkspaceWindowDefinition } from '@/lib/use-workspace'
import { getWorkspaceWindowTitle } from '@/lib/use-workspace'
import type { FileIconContext } from '../lib/use-file-icon'
import { workspaceTabIcon } from '../lib/use-file-icon'
import { FloatingContextMenu } from '../file-browser/FloatingContextMenu'
import { insertIndexFromTabBodyPointer } from './tab-drop-hit'
import { leadingPinnedTabCount } from './tab-group-ops'
import Pin from 'lucide-solid/icons/pin'
import X from 'lucide-solid/icons/x'
import type { Accessor } from 'solid-js'
import { For, Show, createMemo, createSignal, onMount } from 'solid-js'

function TabStripDropSlot(props: {
  groupId: string
  index: number
  /** false: no hit target, no gap, file/window merge use tab bodies instead. */
  active: boolean
  highlighted?: boolean
  mergeHighlight?: boolean
  onDropFile?: (data: FileDragData, insertIndex?: number) => void
  onSlotDragOver: (e: globalThis.DragEvent, index: number) => void
  onSlotDragLeave: (e: globalThis.DragEvent) => void
  onSlotDrop: (e: globalThis.DragEvent, index: number) => void
}) {
  return (
    <div
      data-tab-drop-slot={props.active ? `${props.groupId}:${props.index}` : undefined}
      data-merge-highlight={props.active && props.mergeHighlight ? '' : undefined}
      data-no-window-drag
      class={`flex h-8 shrink-0 items-stretch border-0 p-0 ${
        props.active
          ? `min-w-[12px] w-[12px] ${props.highlighted ? 'bg-primary/80' : ''}`
          : 'pointer-events-none max-w-0 min-w-0 w-0 overflow-hidden select-none'
      }`}
      aria-hidden={props.active ? undefined : true}
      onDragOver={(e) => {
        if (!props.active || !props.onDropFile) return
        props.onSlotDragOver(e, props.index)
      }}
      onDragLeave={(e) => {
        if (!props.active || !props.onDropFile) return
        props.onSlotDragLeave(e)
      }}
      onDrop={(e) => {
        if (!props.active || !props.onDropFile) return
        props.onSlotDrop(e, props.index)
      }}
    />
  )
}

export type WorkspaceTabStripProps = {
  groupId: string
  tabs: Accessor<WorkspaceWindowDefinition[]>
  visibleTabId: string
  isWindowActive: boolean
  fileIconContext: () => FileIconContext
  onSelectTab: (groupId: string, tabId: string) => void
  onFocusWindow: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onToggleTabPinned?: (tabId: string) => void
  onTabPullStart?: (groupId: string, tabId: string, e: PointerEvent) => void
  onDropFile?: (data: FileDragData, insertIndex?: number) => void
  mergeHighlightInsertIndex?: () => number | null
}

type TabContextTarget = { x: number; y: number; tabId: string }

export function WorkspaceTabStrip(props: WorkspaceTabStripProps) {
  let scrollEl: HTMLDivElement | undefined
  const [overflow, setOverflow] = createSignal({ left: false, right: false })
  const [dropSlotIndex, setDropSlotIndex] = createSignal<number | null>(null)
  const [fileDragOver, setFileDragOver] = createSignal(false)
  const [tabMenu, setTabMenu] = createSignal<TabContextTarget | null>(null)

  const tabsList = createMemo(() => props.tabs())

  const checkOverflow = () => {
    const el = scrollEl
    if (!el) return
    setOverflow({
      left: el.scrollLeft > 2,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
    })
  }

  onMount(() => requestAnimationFrame(checkOverflow))

  const pinnedLead = createMemo(() => leadingPinnedTabCount(tabsList()))
  const fileDropSlotActive = (slotIndex: number) =>
    slotIndex === tabsList().length || slotIndex >= pinnedLead()

  const scrollBy = (delta: number) => {
    scrollEl?.scrollBy({ left: delta, behavior: 'smooth' })
    requestAnimationFrame(checkOverflow)
  }

  const handleSlotDragOver = (e: globalThis.DragEvent, index: number) => {
    if (!fileDropSlotActive(index)) return
    const dtr = e.dataTransfer
    if (!props.onDropFile || !dtr || !hasFileDragData(dtr)) return
    e.preventDefault()
    e.stopPropagation()
    dtr.dropEffect = 'copy'
    setDropSlotIndex(index)
    setFileDragOver(true)
  }

  const handleSlotDragLeave = (e: globalThis.DragEvent) => {
    const cur = e.currentTarget as Node | null
    if (cur && !cur.contains(e.relatedTarget as Node)) {
      setDropSlotIndex(null)
    }
  }

  const handleSlotDrop = (e: globalThis.DragEvent, index: number) => {
    setFileDragOver(false)
    setDropSlotIndex(null)
    if (!fileDropSlotActive(index)) return
    if (!props.onDropFile) return
    const dtr = e.dataTransfer
    if (!dtr) return
    const data = getFileDragData(dtr)
    if (!data) return
    e.preventDefault()
    e.stopPropagation()
    props.onDropFile(data, index)
  }

  const handleStripDragLeave = (e: globalThis.DragEvent) => {
    const cur = e.currentTarget as Node | null
    if (cur && !cur.contains(e.relatedTarget as Node)) {
      setFileDragOver(false)
      setDropSlotIndex(null)
    }
  }

  const handleScrollAreaDragOver = (e: globalThis.DragEvent) => {
    const dtr = e.dataTransfer
    if (!props.onDropFile || !dtr || !hasFileDragData(dtr)) return
    e.preventDefault()
    e.stopPropagation()
    dtr.dropEffect = 'copy'
    setFileDragOver(true)
    setDropSlotIndex(tabsList().length)
  }

  const handleScrollAreaDrop = (e: globalThis.DragEvent) => {
    if (!props.onDropFile) return
    const dtr = e.dataTransfer
    if (!dtr) return
    const data = getFileDragData(dtr)
    if (!data) return
    e.preventDefault()
    e.stopPropagation()
    setFileDragOver(false)
    setDropSlotIndex(null)
    props.onDropFile(data, tabsList().length)
  }

  const handleTabPointerDown = (tabId: string, e: PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    props.onSelectTab(props.groupId, tabId)
    props.onFocusWindow(tabId)

    if (tabsList().length <= 1) return
    props.onTabPullStart?.(props.groupId, tabId, e)
  }

  const mergeSlotDisplayIndex = () => {
    const mh = props.mergeHighlightInsertIndex?.() ?? null
    if (mh == null) return null
    const p = pinnedLead()
    return Math.max(mh, p)
  }

  const handleTabFileDragOver = (e: globalThis.DragEvent, tabIndex: number) => {
    const dtr = e.dataTransfer
    if (!props.onDropFile || !dtr || !hasFileDragData(dtr)) return
    e.preventDefault()
    e.stopPropagation()
    dtr.dropEffect = 'copy'
    const el = e.currentTarget as HTMLElement
    const r = el.getBoundingClientRect()
    const insert = insertIndexFromTabBodyPointer(e.clientX, r.left, r.width, tabIndex)
    setDropSlotIndex(Math.max(insert, pinnedLead()))
    setFileDragOver(true)
  }

  const handleTabFileDragLeave = (e: globalThis.DragEvent) => {
    const cur = e.currentTarget as Node | null
    if (cur && !cur.contains(e.relatedTarget as Node)) {
      setDropSlotIndex(null)
    }
  }

  const handleTabFileDrop = (e: globalThis.DragEvent, tabIndex: number) => {
    setFileDragOver(false)
    setDropSlotIndex(null)
    if (!props.onDropFile) return
    const dtr = e.dataTransfer
    if (!dtr) return
    const data = getFileDragData(dtr)
    if (!data) return
    e.preventDefault()
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    const r = el.getBoundingClientRect()
    const insertIndex = Math.max(
      insertIndexFromTabBodyPointer(e.clientX, r.left, r.width, tabIndex),
      pinnedLead(),
    )
    props.onDropFile(data, insertIndex)
  }

  return (
    <div
      class={`workspace-tab-strip relative flex min-w-0 flex-1 items-center ${
        fileDragOver() ? 'ring-1 ring-inset ring-primary bg-primary/10' : ''
      }`}
      onDragLeave={handleStripDragLeave}
    >
      <FloatingContextMenu
        state={tabMenu}
        anchor={(ctx) => ({ x: ctx.x, y: ctx.y })}
        onDismiss={() => setTabMenu(null)}
        pinContextMenuRoot
        data-slot='workspace-tab-context-menu'
        data-testid='workspace-tab-context-menu'
      >
        {(ctx) => {
          const tab = tabsList().find((t) => t.id === ctx.tabId)
          const toggle = props.onToggleTabPinned
          if (!tab || tab.type === 'player' || !toggle) return null
          return (
            <button
              type='button'
              data-slot='context-menu-item'
              data-testid={tab.tabPinned ? 'workspace-tab-menu-unpin' : 'workspace-tab-menu-pin'}
              class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
              role='menuitem'
              onClick={() => {
                toggle(ctx.tabId)
                setTabMenu(null)
              }}
            >
              <Pin class='h-4 w-4 shrink-0' stroke-width={2} />
              {tab.tabPinned ? 'Unpin tab' : 'Pin tab'}
            </button>
          )
        }}
      </FloatingContextMenu>
      <Show when={overflow().left}>
        <button
          type='button'
          data-no-window-drag
          class='absolute left-0 z-10 flex h-8 w-5 items-center justify-center bg-linear-to-r from-muted to-transparent text-muted-foreground'
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => scrollBy(-120)}
        >
          <span class='text-[10px]'>&#9666;</span>
        </button>
      </Show>
      <div
        ref={(el) => {
          scrollEl = el
        }}
        class='scrollbar-none flex min-w-0 flex-1 items-center overflow-x-auto'
        onScroll={checkOverflow}
        onWheel={(e) => {
          e.stopPropagation()
          scrollEl?.scrollBy({ left: e.deltaY || e.deltaX, behavior: 'instant' })
        }}
        onDragOver={handleScrollAreaDragOver}
        onDrop={handleScrollAreaDrop}
      >
        <For each={tabsList()}>
          {(tab, idx) => (
            <div class='flex shrink-0 items-stretch'>
              <TabStripDropSlot
                groupId={props.groupId}
                index={idx()}
                active={fileDropSlotActive(idx())}
                highlighted={dropSlotIndex() === idx()}
                mergeHighlight={mergeSlotDisplayIndex() === idx()}
                onDropFile={props.onDropFile}
                onSlotDragOver={handleSlotDragOver}
                onSlotDragLeave={handleSlotDragLeave}
                onSlotDrop={handleSlotDrop}
              />
              <div
                data-no-window-drag
                data-workspace-tab-id={tab.id}
                class={`flex h-8 min-w-0 max-w-[180px] shrink-0 cursor-pointer items-center gap-1 border-r border-border px-2 ${
                  tab.id === props.visibleTabId ? 'bg-background' : 'bg-muted/50 hover:bg-muted'
                }`}
                onContextMenu={(e) => {
                  if (tab.type === 'player') return
                  e.preventDefault()
                  e.stopPropagation()
                  if (!props.onToggleTabPinned) return
                  setTabMenu({ x: e.clientX, y: e.clientY, tabId: tab.id })
                }}
                onPointerDown={(e) => handleTabPointerDown(tab.id, e)}
                onDragOver={(e) => handleTabFileDragOver(e, idx())}
                onDragLeave={handleTabFileDragLeave}
                onDrop={(e) => handleTabFileDrop(e, idx())}
              >
                <div
                  class={`flex h-4 w-4 shrink-0 items-center justify-center ${
                    props.isWindowActive ? 'text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {workspaceTabIcon(tab, props.fileIconContext())}
                </div>
                <span
                  class={`min-w-0 flex-1 truncate text-[11px] font-medium ${
                    props.isWindowActive ? 'text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {getWorkspaceWindowTitle(tab)}
                </span>
                <Show when={!tab.tabPinned}>
                  <button
                    type='button'
                    data-no-window-drag
                    data-testid='workspace-tab-close'
                    class='ml-auto shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground'
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      props.onCloseTab(tab.id)
                    }}
                  >
                    <X class='lucide-x h-3 w-3' stroke-width={2} />
                  </button>
                </Show>
              </div>
            </div>
          )}
        </For>
        <TabStripDropSlot
          groupId={props.groupId}
          index={tabsList().length}
          active={fileDropSlotActive(tabsList().length)}
          highlighted={dropSlotIndex() === tabsList().length}
          mergeHighlight={mergeSlotDisplayIndex() === tabsList().length}
          onDropFile={props.onDropFile}
          onSlotDragOver={handleSlotDragOver}
          onSlotDragLeave={handleSlotDragLeave}
          onSlotDrop={handleSlotDrop}
        />
      </div>
      <Show when={overflow().right}>
        <button
          type='button'
          data-no-window-drag
          class='absolute right-0 z-10 flex h-8 w-5 items-center justify-center bg-linear-to-l from-muted to-transparent text-muted-foreground'
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => scrollBy(120)}
        >
          <span class='text-[10px]'>&#9656;</span>
        </button>
      </Show>
    </div>
  )
}
