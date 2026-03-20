import type { WorkspaceWindowDefinition } from '@/lib/use-workspace'
import { getWorkspaceWindowTitle } from '@/lib/use-workspace'
import { MediaType } from '@/lib/types'
import File from 'lucide-solid/icons/file'
import Folder from 'lucide-solid/icons/folder'
import Video from 'lucide-solid/icons/video'
import X from 'lucide-solid/icons/x'
import { For, Show, createSignal, onMount } from 'solid-js'

function TabIcon(props: { tab: WorkspaceWindowDefinition }) {
  const t = props.tab
  if (t.type === 'player' || t.iconType === MediaType.VIDEO)
    return <Video class='h-3.5 w-3.5' stroke-width={2} />
  if (t.type === 'browser' || t.iconType === MediaType.FOLDER)
    return <Folder class='h-3.5 w-3.5' stroke-width={2} />
  return <File class='h-3.5 w-3.5' stroke-width={2} />
}

function TabStripDropSlot(props: { groupId: string; index: number; highlighted?: boolean }) {
  return (
    <div
      data-tab-drop-slot={`${props.groupId}:${props.index}`}
      data-no-window-drag
      class={`flex h-8 min-w-[12px] w-[12px] shrink-0 items-stretch ${
        props.highlighted ? 'bg-primary/80' : ''
      }`}
    />
  )
}

export type WorkspaceTabStripProps = {
  groupId: string
  tabs: WorkspaceWindowDefinition[]
  visibleTabId: string
  isWindowActive: boolean
  onSelectTab: (groupId: string, tabId: string) => void
  onFocusWindow: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onDetachTab?: (tabId: string, clientX: number, clientY: number) => void
}

export function WorkspaceTabStrip(props: WorkspaceTabStripProps) {
  let scrollEl!: HTMLDivElement
  const [overflow, setOverflow] = createSignal({ left: false, right: false })

  const checkOverflow = () => {
    const el = scrollEl
    if (!el) return
    setOverflow({
      left: el.scrollLeft > 2,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
    })
  }

  onMount(() => requestAnimationFrame(checkOverflow))

  const scrollBy = (delta: number) => {
    scrollEl?.scrollBy({ left: delta, behavior: 'smooth' })
    requestAnimationFrame(checkOverflow)
  }

  const handleTabPointerDown = (tabId: string) => (e: PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    props.onSelectTab(props.groupId, tabId)
    props.onFocusWindow(tabId)

    if (!props.onDetachTab || props.tabs.length <= 1) return

    const startY = e.clientY
    const startX = e.clientX
    const threshold = 40

    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - startY
      const dx = Math.abs(ev.clientX - startX)
      if (dy > threshold || dx > threshold) {
        props.onDetachTab!(tabId, ev.clientX, ev.clientY)
        cleanup()
      }
    }
    const onUp = () => cleanup()
    const cleanup = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
  }

  return (
    <div class='workspace-tab-strip relative flex min-w-0 flex-1 items-center'>
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
        ref={scrollEl}
        class='scrollbar-none flex min-w-0 flex-1 items-center overflow-x-auto'
        onScroll={checkOverflow}
        onWheel={(e) => {
          e.stopPropagation()
          scrollEl?.scrollBy({ left: e.deltaY || e.deltaX, behavior: 'instant' })
        }}
      >
        <For each={props.tabs}>
          {(tab, idx) => (
            <>
              <TabStripDropSlot groupId={props.groupId} index={idx()} />
              <div
                data-no-window-drag
                data-workspace-tab-id={tab.id}
                class={`flex h-8 min-w-0 max-w-[180px] shrink-0 cursor-pointer items-center gap-1 border-r border-border px-2 ${
                  tab.id === props.visibleTabId ? 'bg-background' : 'bg-muted/50 hover:bg-muted'
                }`}
                onPointerDown={handleTabPointerDown(tab.id)}
              >
                <div
                  class={`flex h-4 w-4 shrink-0 items-center justify-center ${
                    props.isWindowActive ? 'text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  <TabIcon tab={tab} />
                </div>
                <span
                  class={`min-w-0 truncate text-[11px] font-medium ${
                    props.isWindowActive ? 'text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {getWorkspaceWindowTitle(tab)}
                </span>
                <button
                  type='button'
                  data-no-window-drag
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
              </div>
            </>
          )}
        </For>
        <TabStripDropSlot groupId={props.groupId} index={props.tabs.length} />
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

export type WorkspaceSingleTabHeaderProps = {
  groupId: string
  tab: WorkspaceWindowDefinition
  isWindowActive: boolean
}

export function WorkspaceSingleTabHeader(props: WorkspaceSingleTabHeaderProps) {
  return (
    <div class='flex min-w-0 flex-1 items-center'>
      <TabStripDropSlot groupId={props.groupId} index={0} />
      <div class='flex min-w-0 flex-1 items-center gap-1.5 px-2'>
        <div
          class={`flex h-5 w-5 shrink-0 items-center justify-center ${
            props.isWindowActive ? 'text-foreground' : 'text-muted-foreground'
          }`}
        >
          <TabIcon tab={props.tab} />
        </div>
        <div
          class={`min-w-0 truncate text-[11px] font-medium ${
            props.isWindowActive ? 'text-foreground' : 'text-muted-foreground'
          }`}
        >
          {getWorkspaceWindowTitle(props.tab)}
        </div>
      </div>
      <TabStripDropSlot groupId={props.groupId} index={1} />
    </div>
  )
}
