import { localComponent, view, domBinding, list } from 'effectweb'
import type { FileDragData } from '@/lib/files/file-drag-data'
import { getFileDragData, hasFileDragData } from '@/lib/files/file-drag-data'
import type { WindowDefinition as WorkspaceWindowDefinition } from '@/lib/models/window-model'
import { getWorkspaceWindowTitle } from '@/workspace/model/workspace'
import type { FileIconContext } from '@/features/explorer/file-icon'
import { windowIcon } from '@/features/explorer/file-icon'
import { FloatingContextMenu } from '@/features/explorer/FloatingContextMenu'
import { insertIndexFromTabBodyPointer } from './tab-drop-hit'
import {
  insertIndexAfterAllRightTabs,
  leadingPinnedTabCount,
  mergeInsertIndexToRightStripSlot,
  rightStripIndexToGroupInsertIndex,
} from './tab-group-ops'
import Pin from '@effectweb/lucide/icons/pin'
import X from '@effectweb/lucide/icons/x'
type Accessor<T> = () => T
const TabStripDropSlot = view<{
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
}>((props) => {
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
      aria-hidden={props.active ? undefined : 'true'}
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
})
export type WorkspaceTabStripProps = {
  groupId: string
  tabs: Accessor<readonly WorkspaceWindowDefinition[]>
  visibleTabId: Accessor<string>
  isWindowActive: boolean
  fileIconContext: () => FileIconContext
  onActivateTab: (groupId: string, tabId: string) => void
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
export const WorkspaceTabStrip = localComponent<
  WorkspaceTabStripProps,
  {
    scrollElement: HTMLDivElement | null
    overflow: { left: boolean; right: boolean }
    dropSlotIndex: number | null
    fileDragOver: boolean
    tabMenu: TabContextTarget | null
  }
>({
  init: () => ({
    scrollElement: null,
    overflow: { left: false, right: false },
    dropSlotIndex: null,
    fileDragOver: false,
    tabMenu: null,
  }),
  view: view((local, patch) => {
    const props = local.props
    const scrollElement = (): HTMLDivElement | null => local.scrollElement as HTMLDivElement | null
    const setScrollElement = (
      value: HTMLDivElement | null | ((current: HTMLDivElement | null) => HTMLDivElement | null),
    ) => {
      patch({ scrollElement: typeof value === 'function' ? value(scrollElement()) : value })
    }
    const overflow = (): { left: boolean; right: boolean } =>
      local.overflow as { left: boolean; right: boolean }
    const setOverflow = (
      value:
        | { left: boolean; right: boolean }
        | ((current: { left: boolean; right: boolean }) => { left: boolean; right: boolean }),
    ) => {
      patch({ overflow: typeof value === 'function' ? value(overflow()) : value })
    }
    const dropSlotIndex = (): number | null => local.dropSlotIndex as number | null
    const setDropSlotIndex = (
      value: number | null | ((current: number | null) => number | null),
    ) => {
      patch({ dropSlotIndex: typeof value === 'function' ? value(dropSlotIndex()) : value })
    }
    const fileDragOver = (): boolean => local.fileDragOver as boolean
    const setFileDragOver = (value: boolean | ((current: boolean) => boolean)) => {
      patch({ fileDragOver: typeof value === 'function' ? value(fileDragOver()) : value })
    }
    const tabMenu = (): TabContextTarget | null => local.tabMenu as TabContextTarget | null
    const setTabMenu = (
      value:
        | TabContextTarget
        | null
        | ((current: TabContextTarget | null) => TabContextTarget | null),
    ) => {
      patch({ tabMenu: typeof value === 'function' ? value(tabMenu()) : value })
    }
    const allTabs = () => props.tabs()
    const splitLeft = () => props.splitLeftTabId ?? undefined
    const tabsList = () => {
      const id = splitLeft()
      const all = allTabs()
      return id ? all.filter((t) => t.id !== id) : all
    }
    const leftTab = () => {
      const id = props.splitLeftTabId
      if (!id) return undefined
      return allTabs().find((t) => t.id === id)
    }
    const toGroupInsert = (displaySlotIndex: number) =>
      rightStripIndexToGroupInsertIndex(allTabs(), splitLeft(), displaySlotIndex)
    const endGroupSlotIndex = () => {
      const all = allTabs()
      const lid = splitLeft()
      if (lid) return insertIndexAfterAllRightTabs(all, lid)
      return all.length
    }
    const checkOverflow = () => {
      const el = scrollElement()
      if (!el) return
      setOverflow({
        left: el.scrollLeft > 2,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
      })
    }
    const pinnedLead = () => leadingPinnedTabCount(tabsList())
    const pinnedTabs = () => tabsList().slice(0, pinnedLead())
    const scrollableTabs = () => tabsList().slice(pinnedLead())
    const startDisplaySlotIndex = () => pinnedLead()
    const startGroupSlotIndex = () => toGroupInsert(startDisplaySlotIndex())
    const fileDropSlotActiveByDisplay = (displaySlotIndex: number) =>
      displaySlotIndex === tabsList().length || displaySlotIndex >= pinnedLead()
    const fileDropSlotActiveByGroup = (groupInsertIndex: number) => {
      const displayIdx = mergeInsertIndexToRightStripSlot(allTabs(), splitLeft(), groupInsertIndex)
      return fileDropSlotActiveByDisplay(displayIdx)
    }
    const scrollBy = (delta: number) => {
      scrollElement()?.scrollBy({ left: delta, behavior: 'smooth' })
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
      props.onActivateTab(props.groupId, tabId)
      if (allTabs().length <= 1) return
      e.stopPropagation()
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
        class={`workspace-tab-strip flex h-full min-w-0 flex-1 items-stretch ${fileDragOver() ? 'ring-1 ring-inset ring-primary bg-primary/10' : ''}`}
        onDragLeave={handleStripDragLeave}
      >
        <FloatingContextMenu
          state={tabMenu()}
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
            const showUseSplit =
              !splitLeftId && allTabs().length >= 2 && !!props.onUseAsSplitLeftTab
            if (!showPin && !showExit && !showUseSplit) return null
            return (
              <>
                {showExit ? (
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
                ) : null}
                {showUseSplit ? (
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
                ) : null}
                {showPin && toggle ? (
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
                ) : null}
              </>
            )
          }}
        </FloatingContextMenu>
        {((tab) =>
          tab ? (
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
                class={`flex h-4 w-4 shrink-0 items-center justify-center ${props.isWindowActive ? 'text-foreground' : 'text-muted-foreground'}`}
              >
                {windowIcon(tab, props.fileIconContext())}
              </div>
              <span
                class={`min-w-0 flex-1 truncate text-[11px] font-medium ${props.isWindowActive ? 'text-foreground' : 'text-muted-foreground'}`}
              >
                {getWorkspaceWindowTitle(tab)}
              </span>
              {!tab.tabPinned ? (
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
              ) : null}
            </div>
          ) : null)(leftTab())}
        <div class='flex min-w-0 flex-1 items-stretch'>
          {pinnedLead() > 0 ? (
            <div class='flex shrink-0 items-stretch'>
              {list(
                pinnedTabs(),
                (tab) => tab.id,
                (tab) => {
                  const groupBefore = () =>
                    toGroupInsert(pinnedTabs().findIndex((item) => item.id === tab.id))
                  const displayIdx = () => pinnedTabs().findIndex((item) => item.id === tab.id)
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
                        class={`flex h-full min-w-0 max-w-[180px] shrink-0 cursor-pointer items-center gap-1 border-x border-border px-2 ${leftTab() || pinnedTabs().findIndex((item) => item.id === tab.id) > 0 ? '-ml-px' : ''} ${
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
                          class={`flex h-4 w-4 shrink-0 items-center justify-center ${props.isWindowActive ? 'text-foreground' : 'text-muted-foreground'}`}
                        >
                          {windowIcon(tab, props.fileIconContext())}
                        </div>
                        <span
                          class={`min-w-0 flex-1 truncate text-[11px] font-medium ${props.isWindowActive ? 'text-foreground' : 'text-muted-foreground'}`}
                        >
                          {getWorkspaceWindowTitle(tab)}
                        </span>
                        {!tab.tabPinned ? (
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
                        ) : null}
                      </div>
                    </div>
                  )
                },
              )}
            </div>
          ) : null}
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
              {overflow().left ? (
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
              ) : null}
            </div>
            <div
              use={domBinding(
                {
                  setElement: setScrollElement,
                  setOverflow,
                  active: props.visibleTabId(),
                  count: tabsList().length,
                },
                tabScrollBinding,
              )}
              data-testid='workspace-tab-scroll-area'
              class='scrollbar-none flex min-w-0 flex-1 items-stretch overflow-x-auto'
              onScroll={checkOverflow}
              onWheel={(e) => {
                e.stopPropagation()
                scrollElement()?.scrollBy({ left: e.deltaY || e.deltaX, behavior: 'instant' })
              }}
              onDragOver={handleScrollAreaDragOver}
              onDrop={handleScrollAreaDrop}
            >
              {list(
                scrollableTabs(),
                (tab) => tab.id,
                (tab) => {
                  const displayIdx = () =>
                    pinnedLead() + scrollableTabs().findIndex((item) => item.id === tab.id)
                  const groupBefore = () => toGroupInsert(displayIdx())
                  return (
                    <div class='flex shrink-0 items-stretch'>
                      {scrollableTabs().findIndex((item) => item.id === tab.id) > 0 ? (
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
                      ) : null}
                      <div
                        data-no-window-drag
                        data-workspace-tab-id={tab.id}
                        class={`flex h-full min-w-0 max-w-[180px] shrink-0 cursor-pointer items-center gap-1 border-x border-border px-2 ${leftTab() || displayIdx() > 0 ? '-ml-px' : ''} ${
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
                          class={`flex h-4 w-4 shrink-0 items-center justify-center ${props.isWindowActive ? 'text-foreground' : 'text-muted-foreground'}`}
                        >
                          {windowIcon(tab, props.fileIconContext())}
                        </div>
                        <span
                          class={`min-w-0 flex-1 truncate text-[11px] font-medium ${props.isWindowActive ? 'text-foreground' : 'text-muted-foreground'}`}
                        >
                          {getWorkspaceWindowTitle(tab)}
                        </span>
                        {!tab.tabPinned ? (
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
                        ) : null}
                      </div>
                    </div>
                  )
                },
              )}
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
            <div class='relative flex h-full w-3 shrink-0 items-stretch justify-center'>
              {overflow().right ? (
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
              ) : null}
            </div>
          </div>
        </div>
      </div>
    )
  }),
})

const tabScrollBinding = (
  element: HTMLDivElement,
  current: () => {
    setElement: (element: HTMLDivElement | null) => void
    setOverflow: (value: { left: boolean; right: boolean }) => void
    active: string
    count: number
  },
) => {
  let frame: number | undefined
  let previous = ''
  const measure = () => {
    current().setOverflow({
      left: element.scrollLeft > 2,
      right: element.scrollLeft + element.clientWidth < element.scrollWidth - 2,
    })
  }
  const schedule = () => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = undefined
      const active = [...element.querySelectorAll<HTMLElement>('[data-workspace-tab-id]')].find(
        (tab) => tab.dataset.workspaceTabId === current().active,
      )
      if (active) {
        const viewport = element.getBoundingClientRect()
        const tab = active.getBoundingClientRect()
        element.scrollLeft += tab.left + tab.width / 2 - viewport.left - viewport.width / 2
      }
      measure()
    })
  }
  current().setElement(element)
  const observer = new ResizeObserver(schedule)
  observer.observe(element)
  schedule()
  return {
    update() {
      const key = `${current().active}:${current().count}`
      if (key !== previous) {
        previous = key
        schedule()
      }
    },
    dispose() {
      observer.disconnect()
      if (frame !== undefined) cancelAnimationFrame(frame)
      current().setElement(null)
    },
  }
}
