import { getSolidIconComponent, SOLID_AVAILABLE_ICONS } from '@/lib/ui/solid-available-icons'
import { cn } from '@/lib/ui/cn'
import type { WorkspaceRegistry } from '@/workspace/model/workspace-registry'
import { workspaceDisplayName } from '@/workspace/model/workspace-registry'
import { WORKSPACE_TAB_ICON_SWATCHES } from '@/workspace/model/workspace-tab-icon-colors'
import ExternalLink from 'lucide-solid/icons/external-link'
import GripVertical from 'lucide-solid/icons/grip-vertical'
import MonitorUp from 'lucide-solid/icons/monitor-up'
import Palette from 'lucide-solid/icons/palette'
import Plus from 'lucide-solid/icons/plus'
import Trash2 from 'lucide-solid/icons/trash-2'
import ChevronRight from 'lucide-solid/icons/chevron-right'
import { Dynamic } from '@solidjs/web'
import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js'

export type WorkspaceSwitcherProps = {
  open: boolean
  activeId: string
  registry: WorkspaceRegistry
  editable: boolean
  offline: boolean
  onToggle: () => void
  onReveal: () => void
  onDismiss: () => void
  onSelect: (id: string) => void
  onOpenNewTab: (id: string) => void
  onCreate: () => void
  onTakeControl: () => void
  onRename: (id: string, name: string) => Promise<void>
  onIcon: (id: string, icon: string, iconColor: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onReorder: (order: string[]) => Promise<void>
  onDragHover?: (id: string) => void
  draggingWindow?: boolean
  hoverTarget?: string
  transferReady?: boolean
}

export function WorkspaceSwitcher(props: WorkspaceSwitcherProps) {
  const [editing, setEditing] = createSignal<string | null>(null)
  const [menu, setMenu] = createSignal<{
    id: string
    x: number
    y: number
  } | null>(null)
  const [appearanceOpen, setAppearanceOpen] = createSignal(false)
  let draggedId = ''
  let edgeHoverTimer: ReturnType<typeof setTimeout> | undefined
  let panelPointerInside = false

  const clearEdgeHover = () => {
    if (edgeHoverTimer) clearTimeout(edgeHoverTimer)
    edgeHoverTimer = undefined
  }

  onCleanup(clearEdgeHover)

  createEffect(
    () => props.open,
    (open) => {
      if (open) return
      panelPointerInside = false
      setMenu(null)
      setAppearanceOpen(false)
      setEditing(null)
    },
  )

  createEffect(
    () => menu(),
    (currentMenu) => {
      if (!currentMenu) return
      const close = () => {
        setMenu(null)
        setAppearanceOpen(false)
      }
      const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Escape') close()
      }
      document.addEventListener('pointerdown', close)
      document.addEventListener('keydown', onKey)
      onCleanup(() => {
        document.removeEventListener('pointerdown', close)
        document.removeEventListener('keydown', onKey)
      })
    },
  )

  createEffect(
    () => ({ open: props.open, dragging: !!props.draggingWindow, menu: menu() }),
    (state) => {
      if (!state.open || state.dragging || state.menu) return
      const dismissOutside = (event: PointerEvent) => {
        if (props.draggingWindow || menu()) return
        if ((event.target as Element | null)?.closest('[data-testid="workspace-switcher"]')) {
          panelPointerInside = true
          return
        }
        if (panelPointerInside) props.onDismiss()
      }
      document.addEventListener('pointermove', dismissOutside)
      onCleanup(() => document.removeEventListener('pointermove', dismissOutside))
    },
  )

  const beginRename = (id: string) => {
    setMenu(null)
    setAppearanceOpen(false)
    setEditing(id)
  }

  return (
    <>
      <Show when={!props.open && !props.draggingWindow}>
        <div
          class='fixed left-0 top-1/2 z-[999999] h-20 w-3 -translate-y-1/2'
          onPointerEnter={() => {
            clearEdgeHover()
            edgeHoverTimer = setTimeout(() => {
              edgeHoverTimer = undefined
              panelPointerInside = true
              props.onReveal()
            }, 250)
          }}
          onPointerLeave={clearEdgeHover}
          data-testid='workspace-edge-hover-zone'
        />
      </Show>
      <Show when={!props.open && props.draggingWindow}>
        <button
          type='button'
          title='Drag a window here to move it to another workspace'
          aria-label='Show workspaces'
          class='fixed left-0 top-1/2 z-[1000000] flex h-20 w-4 -translate-y-1/2 items-center justify-center rounded-r-md border border-l-0 border-border bg-popover/90 text-muted-foreground shadow-md hover:w-6 hover:text-foreground'
          onClick={() => props.onToggle()}
          data-testid='workspace-edge-handle'
        >
          <ChevronRight class='h-4 w-4' />
        </button>
      </Show>
      <Show when={props.open}>
        <aside
          class='fixed left-0 top-1/2 z-[1000001] flex max-h-[72vh] w-72 -translate-y-1/2 flex-col items-stretch overflow-hidden rounded-r-xl border border-l-0 border-border bg-popover/95 px-2 text-popover-foreground shadow-2xl backdrop-blur'
          data-testid='workspace-switcher'
          onPointerEnter={() => {
            panelPointerInside = true
          }}
          onPointerLeave={() => {
            if (panelPointerInside && !props.draggingWindow && !menu()) props.onDismiss()
          }}
        >
          <div class='min-h-0 w-full overflow-y-auto py-3'>
            <Show when={!props.editable && !props.offline}>
              <button
                class='mb-2 w-full rounded-md border px-2 py-1.5 text-xs hover:bg-muted'
                onClick={() => props.onTakeControl()}
              >
                Take control
              </button>
            </Show>
            <For each={props.registry.order}>
              {(id, index) => {
                const record = () => props.registry.records[id]
                const active = () => id === props.activeId
                const hovered = () => props.draggingWindow && props.hoverTarget === id
                const Icon = () => getSolidIconComponent(record()?.icon ?? '') ?? MonitorUp
                return (
                  <div
                    data-workspace-id={id}
                    class={cn(
                      'group relative mb-1 flex items-center gap-1 overflow-hidden rounded-md border px-1 py-1.5 transition-colors',
                      active()
                        ? 'border-primary bg-primary/10'
                        : 'border-transparent hover:bg-muted',
                      hovered() && 'border-primary bg-primary/20 ring-2 ring-primary/30',
                    )}
                    draggable={props.editable && !props.draggingWindow ? 'true' : 'false'}
                    onDragStart={() => {
                      draggedId = id
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (!props.editable || !draggedId || draggedId === id) return
                      const order = [...props.registry.order]
                      const from = order.indexOf(draggedId)
                      const to = order.indexOf(id)
                      order.splice(from, 1)
                      order.splice(to, 0, draggedId)
                      draggedId = ''
                      void props.onReorder(order).catch(() => {})
                    }}
                    onPointerEnter={() => props.onDragHover?.(id)}
                    onPointerMove={() => props.onDragHover?.(id)}
                    onDblClick={() => beginRename(id)}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      setAppearanceOpen(false)
                      setMenu({
                        id,
                        x: Math.max(4, Math.min(event.clientX, window.innerWidth - 196)),
                        y: Math.max(4, Math.min(event.clientY, window.innerHeight - 360)),
                      })
                    }}
                  >
                    <GripVertical class='h-4 w-4 shrink-0 cursor-grab text-muted-foreground opacity-50' />
                    <button
                      type='button'
                      class='flex min-w-0 flex-1 items-center gap-2 text-left'
                      onClick={() => !active() && props.onSelect(id)}
                    >
                      <Dynamic component={Icon()} class='h-4 w-4 shrink-0' />
                      <span class='min-w-0 flex-1'>
                        <Show
                          when={editing() === id}
                          fallback={
                            <Show
                              when={record()}
                              fallback={
                                <span class='block truncate text-sm'>Workspace {index() + 1}</span>
                              }
                            >
                              {(value) => (
                                <span class='block truncate text-sm'>
                                  {workspaceDisplayName(value(), index() + 1)}
                                </span>
                              )}
                            </Show>
                          }
                        >
                          <input
                            autofocus
                            class='h-7 w-full rounded border bg-background px-2 text-sm'
                            value={record()?.name ?? ''}
                            onClick={(event) => event.stopPropagation()}
                            onDblClick={(event) => event.stopPropagation()}
                            onBlur={(event) => {
                              const name = event.currentTarget.value.trim()
                              setEditing(null)
                              setMenu(null)
                              void props.onRename(id, name).catch(() => {})
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                const name = event.currentTarget.value.trim()
                                setEditing(null)
                                setMenu(null)
                                void props.onRename(id, name).catch(() => {})
                              }
                              if (event.key === 'Escape') {
                                setEditing(null)
                                setMenu(null)
                              }
                            }}
                          />
                        </Show>
                        <span class='block text-[11px] text-muted-foreground'>
                          {hovered()
                            ? props.transferReady
                              ? 'Release to move here'
                              : 'Hold to move here'
                            : `${record()?.snapshot.windows.length ?? 0} windows`}
                        </span>
                      </span>
                    </button>
                    <Show when={hovered()}>
                      <div class='workspace-dwell-progress pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary' />
                    </Show>
                  </div>
                )
              }}
            </For>
            <button
              type='button'
              data-workspace-id='__new__'
              class={cn(
                'relative mt-2 flex w-full items-center gap-2 overflow-hidden rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground',
                props.draggingWindow &&
                  props.hoverTarget === '__new__' &&
                  'border-primary bg-primary/20 text-foreground ring-2 ring-primary/30',
              )}
              onPointerEnter={() => props.onDragHover?.('__new__')}
              onPointerMove={() => props.onDragHover?.('__new__')}
              onClick={() => props.onCreate()}
            >
              <Plus class='h-4 w-4' />
              {props.draggingWindow && props.hoverTarget === '__new__'
                ? 'Hold to create and move'
                : 'New workspace'}
              <Show when={props.draggingWindow && props.hoverTarget === '__new__'}>
                <div class='workspace-dwell-progress pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary' />
              </Show>
            </button>
          </div>
        </aside>

        <Show when={menu()} keyed>
          {(value) => {
            const record = () => props.registry.records[value.id]
            return (
              <div
                class='fixed z-[1000002] min-w-44 rounded-md border border-border bg-popover p-1 text-sm shadow-xl'
                style={{ left: `${value.x}px`, top: `${value.y}px` }}
                data-testid='workspace-context-menu'
                onPointerDown={(event) => event.stopPropagation()}
              >
                <button
                  class='flex w-full rounded px-2 py-1.5 hover:bg-muted'
                  onClick={() => beginRename(value.id)}
                >
                  Rename
                </button>
                <button
                  class='flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-muted'
                  onClick={() => setAppearanceOpen(!appearanceOpen())}
                >
                  <Palette class='h-4 w-4' /> Appearance
                </button>
                <Show when={appearanceOpen()}>
                  <div class='my-1 max-h-52 overflow-y-auto rounded border border-border p-2'>
                    <div class='grid grid-cols-8 gap-1'>
                      <For each={SOLID_AVAILABLE_ICONS}>
                        {(entry) => (
                          <button
                            title={entry.name}
                            class='flex h-7 items-center justify-center rounded hover:bg-muted'
                            onClick={() =>
                              void props
                                .onIcon(value.id, entry.name, record()?.iconColor ?? '')
                                .catch(() => {})
                            }
                          >
                            <entry.Icon class='h-4 w-4' />
                          </button>
                        )}
                      </For>
                    </div>
                    <div class='mt-2 flex flex-wrap gap-1'>
                      <For each={WORKSPACE_TAB_ICON_SWATCHES}>
                        {(color) => (
                          <button
                            title={color.key}
                            class={cn('h-6 w-6 rounded border', color.twBg)}
                            onClick={() =>
                              void props
                                .onIcon(value.id, record()?.icon ?? 'PanelsTopLeft', color.key)
                                .catch(() => {})
                            }
                          />
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
                <Show when={value.id !== props.activeId}>
                  <button
                    class='flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-muted'
                    onClick={() => props.onOpenNewTab(value.id)}
                  >
                    <ExternalLink class='h-4 w-4' /> Open in new tab
                  </button>
                </Show>
                <button
                  class='flex w-full items-center gap-2 rounded px-2 py-1.5 text-destructive hover:bg-muted'
                  onClick={() => void props.onDelete(value.id).catch(() => {})}
                >
                  <Trash2 class='h-4 w-4' /> Delete
                </button>
              </div>
            )
          }}
        </Show>
      </Show>
    </>
  )
}
