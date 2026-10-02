import { component, view, domBinding, list } from 'effectweb'
import { getIconComponent, AVAILABLE_ICONS } from '@/lib/ui/available-icons'
import { cn } from '@/lib/ui/cn'
import type { WorkspaceRegistry } from '@/workspace/model/workspace-registry'
import { workspaceDisplayName } from '@/workspace/model/workspace-registry'
import { WORKSPACE_TAB_ICON_SWATCHES } from '@/workspace/model/workspace-tab-icon-colors'
import ExternalLink from '@effectweb/lucide/icons/external-link'
import GripVertical from '@effectweb/lucide/icons/grip-vertical'
import MonitorUp from '@effectweb/lucide/icons/monitor-up'
import Scan from '@effectweb/lucide/icons/scan'
import Lock from '@effectweb/lucide/icons/lock'
import Palette from '@effectweb/lucide/icons/palette'
import Plus from '@effectweb/lucide/icons/plus'
import Trash2 from '@effectweb/lucide/icons/trash-2'
import ChevronRight from '@effectweb/lucide/icons/chevron-right'
export type WorkspaceSwitcherProps = {
  open: boolean
  activeId: string
  registry: WorkspaceRegistry
  editable: boolean
  onToggle: () => void
  onDismiss: () => void
  onSelect: (id: string) => void
  onOpenNewTab: (id: string) => void
  onCreate: () => void
  onTakeControl: () => void
  onRename: (id: string, name: string) => void
  onIcon: (id: string, icon: string, iconColor: string) => void
  onDelete: (id: string) => void
  onConvert: (id: string) => void
  onReorder: (order: string[]) => void
  onDragHover?: (id: string) => void
  draggingWindow?: boolean
  hoverTarget?: string
  transferReady?: boolean
}
export const WorkspaceSwitcher = view<WorkspaceSwitcherProps>((props) => {
  return (
    <>
      {!props.open && props.draggingWindow ? (
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
      ) : null}
      {props.open ? <WorkspaceSwitcherPanel {...props} /> : null}
    </>
  )
})
const WorkspaceSwitcherPanel = component<
  WorkspaceSwitcherProps,
  {
    editing: string | null
    menu: { id: string; x: number; y: number } | null
    appearanceOpen: boolean
    draggedId: string
    panelPointerInside: boolean
  }
>(
  {
    init: () => ({
      editing: null,
      menu: null,
      appearanceOpen: false,
      draggedId: '',
      panelPointerInside: false,
    }),
  },
  view((local, patch) => {
    const props = local.props
    const editing = (): string | null => local.editing as string | null
    const setEditing = (value: string | null | ((current: string | null) => string | null)) => {
      patch({ editing: typeof value === 'function' ? value(editing()) : value })
    }
    const menu = (): { id: string; x: number; y: number } | null =>
      local.menu as { id: string; x: number; y: number } | null
    const setMenu = (
      value:
        | { id: string; x: number; y: number }
        | null
        | ((
            current: { id: string; x: number; y: number } | null,
          ) => { id: string; x: number; y: number } | null),
    ) => {
      patch({ menu: typeof value === 'function' ? value(menu()) : value })
    }
    const appearanceOpen = (): boolean => local.appearanceOpen as boolean
    const setAppearanceOpen = (value: boolean | ((current: boolean) => boolean)) => {
      patch({ appearanceOpen: typeof value === 'function' ? value(appearanceOpen()) : value })
    }
    const draggedId = (): typeof local.draggedId => local.draggedId as typeof local.draggedId
    const setDraggedId = (
      value: typeof local.draggedId | ((current: typeof local.draggedId) => typeof local.draggedId),
    ) => {
      patch({ draggedId: typeof value === 'function' ? value(draggedId()) : value })
    }
    const panelPointerInside = (): boolean => local.panelPointerInside as boolean
    const setPanelPointerInside = (value: boolean | ((current: boolean) => boolean)) => {
      patch({
        panelPointerInside: typeof value === 'function' ? value(panelPointerInside()) : value,
      })
    }
    const beginRename = (id: string) => {
      setMenu(null)
      setAppearanceOpen(false)
      setEditing(id)
    }
    return (
      <>
        <aside
          class='fixed left-0 top-1/2 z-[1000001] flex max-h-[72vh] w-72 -translate-y-1/2 flex-col items-stretch overflow-hidden rounded-r-xl border border-l-0 border-border bg-popover/95 px-2 text-popover-foreground shadow-2xl backdrop-blur'
          data-testid='workspace-switcher'
          use={domBinding(
            {
              closeMenu: () => {
                setMenu(null)
                setAppearanceOpen(false)
              },
              dismiss: props.onDismiss,
              menu: !!menu(),
              dragging: !!props.draggingWindow,
            },
            switcherEvents,
          )}
          onPointerEnter={() => {
            setPanelPointerInside(true)
          }}
          onPointerLeave={() => {
            if (panelPointerInside() && !props.draggingWindow && !menu()) props.onDismiss()
          }}
        >
          <div class='min-h-0 w-full overflow-y-auto py-3'>
            {!props.editable ? (
              <button
                class='mb-2 w-full rounded-md border px-2 py-1.5 text-xs hover:bg-muted'
                onClick={() => props.onTakeControl()}
              >
                Take control
              </button>
            ) : null}
            {list(
              props.registry.order,
              (id) => id,
              (id) => {
                const record = () => props.registry.records[id]
                const active = () => id === props.activeId
                const locked = () => record()?.locked === true
                const hovered = () => props.draggingWindow && props.hoverTarget === id
                const Icon =
                  getIconComponent(record()?.icon ?? '') ??
                  (record()?.snapshot.workspaceType === 'canvas' ? Scan : MonitorUp)
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
                      setDraggedId(id)
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (!props.editable || !draggedId() || draggedId() === id) return
                      const order = [...props.registry.order]
                      const from = order.indexOf(draggedId())
                      const to = order.indexOf(id)
                      order.splice(from, 1)
                      order.splice(to, 0, draggedId())
                      setDraggedId('')
                      props.onReorder(order)
                    }}
                    onPointerEnter={() => props.onDragHover?.(id)}
                    onPointerMove={() => props.onDragHover?.(id)}
                    onPointerLeave={() => props.onDragHover?.('')}
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
                      <Icon class='h-4 w-4 shrink-0' />
                      {record()?.snapshot.workspaceType === 'canvas' && record()?.icon ? (
                        <Scan class='-ml-3 mt-3 size-2.5 shrink-0 rounded-sm bg-popover text-primary' />
                      ) : null}
                      <span class='min-w-0 flex-1'>
                        {editing() === id ? (
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
                              props.onRename(id, name)
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                const name = event.currentTarget.value.trim()
                                setEditing(null)
                                setMenu(null)
                                props.onRename(id, name)
                              }
                              if (event.key === 'Escape') {
                                setEditing(null)
                                setMenu(null)
                              }
                            }}
                          />
                        ) : (
                          ((value) =>
                            value ? (
                              <span class='block truncate text-sm'>
                                {workspaceDisplayName(value, props.registry.order.indexOf(id) + 1)}
                              </span>
                            ) : (
                              <span class='block truncate text-sm'>
                                Workspace {props.registry.order.indexOf(id) + 1}
                              </span>
                            ))(record())
                        )}
                        <span class='block text-[11px] text-muted-foreground'>
                          {hovered()
                            ? props.transferReady
                              ? 'Release to move here'
                              : 'Hold to move here'
                            : locked()
                              ? 'Open in another tab'
                              : record()?.snapshot.workspaceType === 'canvas'
                                ? `${new Set(record()?.snapshot.windows.map((window) => window.tabGroupId ?? window.id) ?? []).size} cards`
                                : `${record()?.snapshot.windows.length ?? 0} windows`}
                        </span>
                      </span>
                      {locked() ? (
                        <Lock
                          class='lucide-lock h-4 w-4 shrink-0 text-muted-foreground'
                          aria-label='Open in another tab'
                        />
                      ) : null}
                    </button>
                    {hovered() ? (
                      <div class='workspace-dwell-progress pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary' />
                    ) : null}
                  </div>
                )
              },
            )}
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
              onPointerLeave={() => props.onDragHover?.('')}
              onClick={() => {
                if (props.draggingWindow) return
                props.onCreate()
              }}
            >
              <Plus class='h-4 w-4' />
              {props.draggingWindow && props.hoverTarget === '__new__'
                ? 'Hold to create and move'
                : 'New workspace'}
              {props.draggingWindow && props.hoverTarget === '__new__' ? (
                <div class='workspace-dwell-progress pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary' />
              ) : null}
            </button>
          </div>
        </aside>

        {((value) => {
          if (!value) return null

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
              {appearanceOpen() ? (
                <div class='my-1 max-h-52 overflow-y-auto rounded border border-border p-2'>
                  <div class='grid grid-cols-8 gap-1'>
                    {list(
                      AVAILABLE_ICONS,
                      (entry) => entry.name,
                      (entry) => (
                        <button
                          title={entry.name}
                          class='flex h-7 items-center justify-center rounded hover:bg-muted'
                          onClick={() =>
                            props.onIcon(value.id, entry.name, record()?.iconColor ?? '')
                          }
                        >
                          <entry.Icon class='h-4 w-4' />
                        </button>
                      ),
                    )}
                  </div>
                  <div class='mt-2 flex flex-wrap gap-1'>
                    {list(
                      WORKSPACE_TAB_ICON_SWATCHES,
                      (color) => color.key,
                      (color) => (
                        <button
                          title={color.key}
                          class={cn('h-6 w-6 rounded border', color.twBg)}
                          onClick={() =>
                            props.onIcon(value.id, record()?.icon ?? 'PanelsTopLeft', color.key)
                          }
                        />
                      ),
                    )}
                  </div>
                </div>
              ) : null}
              {value.id !== props.activeId ? (
                <button
                  class='flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-muted'
                  onClick={() => props.onOpenNewTab(value.id)}
                >
                  <ExternalLink class='h-4 w-4' /> Open in new tab
                </button>
              ) : null}
              <button
                class='flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-muted'
                onClick={() => props.onConvert(value.id)}
              >
                {record()?.snapshot.workspaceType === 'canvas' ? (
                  <MonitorUp class='h-4 w-4' />
                ) : (
                  <Scan class='h-4 w-4' />
                )}
                Convert to {record()?.snapshot.workspaceType === 'canvas' ? 'desktop' : 'canvas'}
              </button>
              <button
                class='flex w-full items-center gap-2 rounded px-2 py-1.5 text-destructive hover:bg-muted'
                onClick={() => props.onDelete(value.id)}
              >
                <Trash2 class='h-4 w-4' /> Delete
              </button>
            </div>
          )
        })(menu())}
      </>
    )
  }),
)

const switcherEvents = (
  _element: HTMLElement,
  current: () => { closeMenu: () => void; dismiss: () => void; menu: boolean; dragging: boolean },
) => {
  let inside = false
  const pointer = (event: PointerEvent) => {
    const target = event.target as Element | null
    if (
      event.type === 'pointerdown' &&
      current().menu &&
      !target?.closest('[data-testid="workspace-context-menu"]')
    )
      current().closeMenu()
    if (event.type !== 'pointermove' || current().dragging || current().menu) return
    if (
      target?.closest('[data-testid="workspace-switcher"], [data-testid="workspace-context-menu"]')
    )
      inside = true
    else if (inside) current().dismiss()
  }
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') current().closeMenu()
  }
  document.addEventListener('pointerdown', pointer)
  document.addEventListener('pointermove', pointer)
  document.addEventListener('keydown', key)
  return () => {
    document.removeEventListener('pointerdown', pointer)
    document.removeEventListener('pointermove', pointer)
    document.removeEventListener('keydown', key)
  }
}
