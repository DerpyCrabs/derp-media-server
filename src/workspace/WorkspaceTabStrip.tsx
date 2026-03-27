import type { FileDragData } from '@/lib/file-drag-data'
import { getFileDragData, hasFileDragData } from '@/lib/file-drag-data'
import type { WorkspaceWindowDefinition } from '@/lib/use-workspace'
import { getWorkspaceWindowTitle } from '@/lib/use-workspace'
import type { FileIconContext } from '../lib/use-file-icon'
import { workspaceTabIcon } from '../lib/use-file-icon'
import { FloatingContextMenu } from '../file-browser/FloatingContextMenu'
import { insertIndexFromTabBodyPointer } from './tab-drop-hit'
import {
  insertIndexAfterAllRightTabs,
  leadingPinnedTabCount,
  mergeInsertIndexToRightStripSlot,
  rightStripIndexToGroupInsertIndex,
} from './tab-group-ops'
import Pin from 'lucide-solid/icons/pin'
import X from 'lucide-solid/icons/x'
import type { Accessor } from 'solid-js'
import { For, Show, createEffect, createMemo, createSignal, onMount } from 'solid-js'

function TabStripDropSlot(props: {
  groupId: string
  groupSlotIndex: number
  /** false: no hit target, no gap, file/window merge use tab bodies instead. */
  active: boolean
  highlighted?: boolean
  mergeHighlight?: boolean
  onDropFile?: (data: FileDragData, groupInsertIndex?: number) => void
  onSlotDragOver: (e: globalThis.DragEvent, groupInsertIndex: number) => void
  onSlotDragLeave: (e: globalThis.DragEvent) => void
  onSlotDrop: (e: globalThis.DragEvent, groupInsertIndex: number) => void
}) {
  return (
    <div
      data-tab-drop-slot={props.active ? `${props.groupId}:${props.groupSlotIndex}` : undefined}
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
        props.onSlotDragOver(e, props.groupSlotIndex)
      }}
      onDragLeave={(e) => {
        if (!props.active || !props.onDropFile) return
        props.onSlotDragLeave(e)
      }}
      onDrop={(e) => {
        if (!props.active || !props.onDropFile) return
        props.onSlotDrop(e, props.groupSlotIndex)
      }}
    />
  )
}

export type WorkspaceTabStripProps = {
  groupId: string
  tabs: Accessor<WorkspaceWindowDefinition[]>
  visibleTabId: Accessor<string>
  isWindowActive: boolean
  fileIconContext: () => FileIconContext
  onSelectTab: (groupId: string, tabId: string) => void
  onFocusWindow: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onToggleTabPinned?: (tabId: string) => void
  onTabPullStart?: (groupId: string, tabId: string, e: PointerEvent) => void
  onDropFile?: (data: FileDragData, groupInsertIndex?: number) => void
  mergeHighlightInsertIndex?: () => number | null
  splitLeftTabId?: string | null
  onExitSplitView?: () => void
  onUseAsSplitLeftTab?: (tabId: string) => void
}

type TabContextTarget = { x: number; y: number; tabId: string }

export function WorkspaceTabStrip(props: WorkspaceTabStripProps) {
  let scrollEl: HTMLDivElement | undefined
  const [overflow, setOverflow] = createSignal({ left: false, right: false })
  const [dropSlotIndex, setDropSlotIndex] = createSignal<number | null>(null)
  const [fileDragOver, setFileDragOver] = createSignal(false)
  const [tabMenu, setTabMenu] = createSignal<TabContextTarget | null>(null)

  const allTabs = createMemo(() => props.tabs())
  const splitLeft = createMemo(() => props.splitLeftTabId ?? undefined)
  const tabsList = createMemo(() => {
    const id = splitLeft()
    const all = allTabs()
    return id ? all.filter((t) => t.id !== id) : all
  })
  const leftTab = createMemo(() => {
    const id = props.splitLeftTabId
    if (!id) return undefined
    return allTabs().find((t) => t.id === id)
  })

  const toGroupInsert = (displaySlotIndex: number) =>
    rightStripIndexToGroupInsertIndex(allTabs(), splitLeft(), displaySlotIndex)

  const endGroupSlotIndex = createMemo(() => {
    const all = allTabs()
    const lid = splitLeft()
    if (lid) return insertIndexAfterAllRightTabs(all, lid)
    return all.length
  })

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
  const pinnedTabs = createMemo(() => tabsList().slice(0, pinnedLead()))
  const scrollableTabs = createMemo(() => tabsList().slice(pinnedLead()))

  createEffect(() => {
    tabsList()
    pinnedLead()
    queueMicrotask(() => checkOverflow())
  })
  const fileDropSlotActiveByDisplay = (displaySlotIndex: number) =>
    displaySlotIndex === tabsList().length || displaySlotIndex >= pinnedLead()

  const fileDropSlotActiveByGroup = (groupInsertIndex: number) => {
    const displayIdx = mergeInsertIndexToRightStripSlot(allTabs(), splitLeft(), groupInsertIndex)
    return fileDropSlotActiveByDisplay(displayIdx)
  }

  const scrollBy = (delta: number) => {
    scrollEl?.scrollBy({ left: delta, behavior: 'smooth' })
    requestAnimationFrame(checkOverflow)
  }

  const handleSlotDragOver = (e: globalThis.DragEvent, groupInsertIndex: number) => {
    if (!fileDropSlotActiveByGroup(groupInsertIndex)) return
    const dtr = e.dataTransfer
    if (!props.onDropFile || !dtr || !hasFileDragData(dtr)) return
    e.preventDefault()
    e.stopPropagation()
    dtr.dropEffect = 'copy'
    setDropSlotIndex(groupInsertIndex)
    setFileDragOver(true)
  }

  const handleSlotDragLeave = (e: globalThis.DragEvent) => {
    const cur = e.currentTarget as Node | null
    if (cur && !cur.contains(e.relatedTarget as Node)) {
      setDropSlotIndex(null)
    }
  }

  const handleSlotDrop = (e: globalThis.DragEvent, groupInsertIndex: number) => {
    setFileDragOver(false)
    setDropSlotIndex(null)
    if (!fileDropSlotActiveByGroup(groupInsertIndex)) return
    if (!props.onDropFile) return
    const dtr = e.dataTransfer
    if (!dtr) return
    const data = getFileDragData(dtr)
    if (!data) return
    e.preventDefault()
    e.stopPropagation()
    props.onDropFile(data, groupInsertIndex)
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
    setDropSlotIndex(endGroupSlotIndex())
    setFileDragOver(true)
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
    const end = endGroupSlotIndex()
    if (!fileDropSlotActiveByGroup(end)) return
    props.onDropFile(data, end)
  }

  const handleTabPointerDown = (tabId: string, e: PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    props.onSelectTab(props.groupId, tabId)
    props.onFocusWindow(tabId)

    if (allTabs().length <= 1) return
    props.onTabPullStart?.(props.groupId, tabId, e)
  }

  const handleLeftSplitTabPointerDown = (tabId: string, e: PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    props.onFocusWindow(tabId)
  }

  const mergeHighlightForGroupSlot = (groupSlotIndex: number) => {
    const mh = props.mergeHighlightInsertIndex?.() ?? null
    return mh != null && mh === groupSlotIndex
  }

  const handleTabFileDragOver = (e: globalThis.DragEvent, displayTabIndex: number) => {
    const dtr = e.dataTransfer
    if (!props.onDropFile || !dtr || !hasFileDragData(dtr)) return
    e.preventDefault()
    e.stopPropagation()
    dtr.dropEffect = 'copy'
    const el = e.currentTarget as HTMLElement
    const r = el.getBoundingClientRect()
    const insert = insertIndexFromTabBodyPointer(e.clientX, r.left, r.width, displayTabIndex)
    const displaySlot = Math.max(insert, pinnedLead())
    setDropSlotIndex(toGroupInsert(displaySlot))
    setFileDragOver(true)
  }

  const handleTabFileDragLeave = (e: globalThis.DragEvent) => {
    const cur = e.currentTarget as Node | null
    if (cur && !cur.contains(e.relatedTarget as Node)) {
      setDropSlotIndex(null)
    }
  }

  const handleTabFileDrop = (e: globalThis.DragEvent, displayTabIndex: number) => {
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
    const insert = Math.max(
      insertIndexFromTabBodyPointer(e.clientX, r.left, r.width, displayTabIndex),
      pinnedLead(),
    )
    const groupIns = toGroupInsert(insert)
    if (!fileDropSlotActiveByGroup(groupIns)) return
    props.onDropFile(data, groupIns)
  }

  return (
    <div
      class={`workspace-tab-strip flex min-w-0 flex-1 items-center ${
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
          const tab = allTabs().find((t) => t.id === ctx.tabId)
          if (!tab) return null
          const toggle = props.onToggleTabPinned
          const splitLeftId = props.splitLeftTabId
          const isSplitLeft = !!splitLeftId && ctx.tabId === splitLeftId
          const showPin = !!toggle && !isSplitLeft
          const showExit = isSplitLeft && !!props.onExitSplitView
          const showUseSplit = !splitLeftId && allTabs().length >= 2 && !!props.onUseAsSplitLeftTab
          if (!showPin && !showExit && !showUseSplit) return null
          return (
            <>
              <Show when={showExit}>
                <button
                  type='button'
                  data-slot='context-menu-item'
                  data-testid='workspace-tab-menu-exit-split'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => {
                    props.onExitSplitView?.()
                    setTabMenu(null)
                  }}
                >
                  Exit split view
                </button>
              </Show>
              <Show when={showUseSplit}>
                <button
                  type='button'
                  data-slot='context-menu-item'
                  data-testid='workspace-tab-menu-use-split-left'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => {
                    props.onUseAsSplitLeftTab?.(ctx.tabId)
                    setTabMenu(null)
                  }}
                >
                  Use as split left tab
                </button>
              </Show>
              <Show when={showPin && toggle}>
                <button
                  type='button'
                  data-slot='context-menu-item'
                  data-testid={
                    tab.tabPinned ? 'workspace-tab-menu-unpin' : 'workspace-tab-menu-pin'
                  }
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => {
                    toggle?.(ctx.tabId)
                    setTabMenu(null)
                  }}
                >
                  <Pin class='h-4 w-4 shrink-0' stroke-width={2} />
                  {tab.tabPinned ? 'Unpin tab' : 'Pin tab'}
                </button>
              </Show>
            </>
          )
        }}
      </FloatingContextMenu>
      <Show when={leftTab()}>
        {(lt) => {
          const tab = lt()
          return (
            <div
              data-no-window-drag
              data-workspace-tab-id={tab.id}
              data-workspace-split-left-tab=''
              title='Split left tab (fixed pane)'
              class='flex h-8 min-w-0 max-w-[180px] shrink-0 cursor-pointer items-center gap-1 border-r border-border border-l-0 bg-chart-1/22 px-2 shadow-none outline-none hover:bg-chart-1/35'
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setTabMenu({ x: e.clientX, y: e.clientY, tabId: tab.id })
              }}
              onPointerDown={(e) => handleLeftSplitTabPointerDown(tab.id, e)}
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
          )
        }}
      </Show>
      <div class='flex min-w-0 flex-1 items-stretch'>
        <Show when={pinnedLead() > 0}>
          <div class='flex shrink-0 items-stretch border-r border-border'>
            <For each={pinnedTabs()}>
              {(tab, idx) => {
                const groupBefore = () => toGroupInsert(idx())
                const displayIdx = () => idx()
                return (
                  <div class='flex shrink-0 items-stretch'>
                    <TabStripDropSlot
                      groupId={props.groupId}
                      groupSlotIndex={groupBefore()}
                      active={fileDropSlotActiveByDisplay(displayIdx())}
                      highlighted={dropSlotIndex() === groupBefore()}
                      mergeHighlight={mergeHighlightForGroupSlot(groupBefore())}
                      onDropFile={props.onDropFile}
                      onSlotDragOver={handleSlotDragOver}
                      onSlotDragLeave={handleSlotDragLeave}
                      onSlotDrop={handleSlotDrop}
                    />
                    <div
                      data-no-window-drag
                      data-workspace-tab-id={tab.id}
                      class={`flex h-8 min-w-0 max-w-[180px] shrink-0 cursor-pointer items-center gap-1 border-r border-border px-2 ${
                        tab.id === props.visibleTabId()
                          ? 'bg-background'
                          : 'bg-muted/50 hover:bg-muted'
                      }`}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setTabMenu({ x: e.clientX, y: e.clientY, tabId: tab.id })
                      }}
                      onPointerDown={(e) => handleTabPointerDown(tab.id, e)}
                      onDragOver={(e) => handleTabFileDragOver(e, displayIdx())}
                      onDragLeave={handleTabFileDragLeave}
                      onDrop={(e) => handleTabFileDrop(e, displayIdx())}
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
                )
              }}
            </For>
          </div>
        </Show>
        <div class='relative flex min-w-0 flex-1 items-center'>
          <Show when={overflow().left}>
            <button
              type='button'
              data-no-window-drag
              class='absolute left-0 z-10 flex h-8 w-5 items-center justify-center bg-gradient-to-r from-muted/90 to-transparent text-muted-foreground'
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
            class={`scrollbar-none flex min-w-0 flex-1 items-center overflow-x-auto ${overflow().left ? 'pl-5' : ''} ${overflow().right ? 'pr-5' : ''}`}
            onScroll={checkOverflow}
            onWheel={(e) => {
              e.stopPropagation()
              scrollEl?.scrollBy({ left: e.deltaY || e.deltaX, behavior: 'instant' })
            }}
            onDragOver={handleScrollAreaDragOver}
            onDrop={handleScrollAreaDrop}
          >
            <For each={scrollableTabs()}>
              {(tab, idx) => {
                const displayIdx = () => pinnedLead() + idx()
                const groupBefore = () => toGroupInsert(displayIdx())
                return (
                  <div class='flex shrink-0 items-stretch'>
                    <TabStripDropSlot
                      groupId={props.groupId}
                      groupSlotIndex={groupBefore()}
                      active={fileDropSlotActiveByDisplay(displayIdx())}
                      highlighted={dropSlotIndex() === groupBefore()}
                      mergeHighlight={mergeHighlightForGroupSlot(groupBefore())}
                      onDropFile={props.onDropFile}
                      onSlotDragOver={handleSlotDragOver}
                      onSlotDragLeave={handleSlotDragLeave}
                      onSlotDrop={handleSlotDrop}
                    />
                    <div
                      data-no-window-drag
                      data-workspace-tab-id={tab.id}
                      class={`flex h-8 min-w-0 max-w-[180px] shrink-0 cursor-pointer items-center gap-1 border-r border-border px-2 ${
                        tab.id === props.visibleTabId()
                          ? 'bg-background'
                          : 'bg-muted/50 hover:bg-muted'
                      }`}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setTabMenu({ x: e.clientX, y: e.clientY, tabId: tab.id })
                      }}
                      onPointerDown={(e) => handleTabPointerDown(tab.id, e)}
                      onDragOver={(e) => handleTabFileDragOver(e, displayIdx())}
                      onDragLeave={handleTabFileDragLeave}
                      onDrop={(e) => handleTabFileDrop(e, displayIdx())}
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
                )
              }}
            </For>
            <TabStripDropSlot
              groupId={props.groupId}
              groupSlotIndex={endGroupSlotIndex()}
              active={fileDropSlotActiveByDisplay(tabsList().length)}
              highlighted={dropSlotIndex() === endGroupSlotIndex()}
              mergeHighlight={mergeHighlightForGroupSlot(endGroupSlotIndex())}
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
              class='absolute right-0 z-10 flex h-8 w-5 items-center justify-center bg-gradient-to-l from-muted/90 to-transparent text-muted-foreground'
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => scrollBy(120)}
            >
              <span class='text-[10px]'>&#9656;</span>
            </button>
          </Show>
        </div>
      </div>
    </div>
  )
}
