import type { FileDragData } from '@/lib/files/file-drag-data'
import { getFileDragData, hasFileDragData } from '@/lib/files/file-drag-data'
import type { WorkspaceWindowDefinition } from '@/workspace/model/use-workspace'
import { getWorkspaceWindowTitle } from '@/workspace/model/use-workspace'
import type { FileIconContext } from '@/features/explorer/use-file-icon'
import { windowIcon } from '@/features/explorer/use-file-icon'
import { FloatingContextMenu } from '@/features/explorer/FloatingContextMenu'
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
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'

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
      class={`flex h-full shrink-0 items-stretch border-0 p-0 ${
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

  const pinnedLead = createMemo(() => leadingPinnedTabCount(tabsList()))
  const pinnedTabs = createMemo(() => tabsList().slice(0, pinnedLead()))
  const scrollableTabs = createMemo(() => tabsList().slice(pinnedLead()))
  const startDisplaySlotIndex = () => pinnedLead()
  const startGroupSlotIndex = () => toGroupInsert(startDisplaySlotIndex())

  let focusScrollFrame: number | undefined

  const scrollFocusedTabIntoView = () => {
    const el = scrollEl
    if (!el) return
    const focusedTab = [...el.querySelectorAll<HTMLElement>('[data-workspace-tab-id]')].find(
      (tab) => tab.dataset.workspaceTabId === props.visibleTabId(),
    )
    if (focusedTab) {
      const viewport = el.getBoundingClientRect()
      const tab = focusedTab.getBoundingClientRect()
      el.scrollLeft += tab.left + tab.width / 2 - (viewport.left + viewport.width / 2)
    }
    checkOverflow()
  }

  const scheduleFocusedTabScroll = () => {
    if (focusScrollFrame !== undefined) cancelAnimationFrame(focusScrollFrame)
    focusScrollFrame = requestAnimationFrame(() => {
      focusScrollFrame = undefined
      scrollFocusedTabIntoView()
    })
  }

  onMount(() => {
    const observer = new ResizeObserver(scheduleFocusedTabScroll)
    if (scrollEl) observer.observe(scrollEl)
    scheduleFocusedTabScroll()
    onCleanup(() => {
      observer.disconnect()
      if (focusScrollFrame !== undefined) cancelAnimationFrame(focusScrollFrame)
    })
  })

  createEffect(() => {
    tabsList()
    pinnedLead()
    props.visibleTabId()
    scheduleFocusedTabScroll()
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
      class={`workspace-tab-strip flex h-full min-w-0 flex-1 items-stretch ${
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
              class='flex h-full min-w-0 max-w-[180px] shrink-0 cursor-pointer items-center gap-1 border-x border-border bg-chart-1/22 px-2 shadow-none outline-none hover:bg-chart-1/35'
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
                {windowIcon(tab, props.fileIconContext())}
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
          <div class='flex shrink-0 items-stretch'>
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
                      class={`flex h-full min-w-0 max-w-[180px] shrink-0 cursor-pointer items-center gap-1 border-x border-border px-2 ${
                        leftTab() || idx() > 0 ? '-ml-px' : ''
                      } ${
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
                        {windowIcon(tab, props.fileIconContext())}
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
        <div class='flex min-w-0 flex-1 items-stretch'>
          <div class='relative flex h-full w-3 shrink-0 items-stretch justify-center'>
            <TabStripDropSlot
              groupId={props.groupId}
              groupSlotIndex={startGroupSlotIndex()}
              active={fileDropSlotActiveByDisplay(startDisplaySlotIndex())}
              highlighted={dropSlotIndex() === startGroupSlotIndex()}
              mergeHighlight={mergeHighlightForGroupSlot(startGroupSlotIndex())}
              onDropFile={props.onDropFile}
              onSlotDragOver={handleSlotDragOver}
              onSlotDragLeave={handleSlotDragLeave}
              onSlotDrop={handleSlotDrop}
            />
            <Show when={overflow().left}>
              <button
                type='button'
                data-no-window-drag
                data-tab-drop-slot={`${props.groupId}:${startGroupSlotIndex()}`}
                aria-label='Scroll tabs left'
                class='absolute inset-0 z-10 flex items-center justify-center bg-muted/90 text-muted-foreground'
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => scrollBy(-120)}
                onDragOver={(e) => handleSlotDragOver(e, startGroupSlotIndex())}
                onDragLeave={handleSlotDragLeave}
                onDrop={(e) => handleSlotDrop(e, startGroupSlotIndex())}
              >
                <span class='text-[10px]'>&#9666;</span>
              </button>
            </Show>
          </div>
          <div
            ref={(el) => {
              scrollEl = el
            }}
            data-testid='workspace-tab-scroll-area'
            class='scrollbar-none flex min-w-0 flex-1 items-stretch overflow-x-auto'
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
                    <Show when={idx() > 0}>
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
                    </Show>
                    <div
                      data-no-window-drag
                      data-workspace-tab-id={tab.id}
                      class={`flex h-full min-w-0 max-w-[180px] shrink-0 cursor-pointer items-center gap-1 border-x border-border px-2 ${
                        leftTab() || displayIdx() > 0 ? '-ml-px' : ''
                      } ${
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
                        {windowIcon(tab, props.fileIconContext())}
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
          <div class='relative flex h-full w-3 shrink-0 items-stretch justify-center'>
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
            <Show when={overflow().right}>
              <button
                type='button'
                data-no-window-drag
                data-tab-drop-slot={`${props.groupId}:${endGroupSlotIndex()}`}
                aria-label='Scroll tabs right'
                class='absolute inset-0 z-10 flex items-center justify-center bg-muted/90 text-muted-foreground'
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => scrollBy(120)}
                onDragOver={(e) => handleSlotDragOver(e, endGroupSlotIndex())}
                onDragLeave={handleSlotDragLeave}
                onDrop={(e) => handleSlotDrop(e, endGroupSlotIndex())}
              >
                <span class='text-[10px]'>&#9656;</span>
              </button>
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}
