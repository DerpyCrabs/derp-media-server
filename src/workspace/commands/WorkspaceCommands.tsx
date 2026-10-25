import {
  controllerView,
  domBinding,
  list,
  modelOwner,
  Portal,
  view,
  type DomLifetime,
  type ControllerModel,
} from 'effectweb'
import { modalFocus } from '@/lib/ui/modal-focus'
import { randomId } from '@/lib/random-id'
import { filterWorkspaceCommands, onWorkspaceCommands, type WorkspaceCommand } from './commands'
type Props = { items: readonly WorkspaceCommand[]; available: boolean }
function controller(props: Props) {
  const owner = modelOwner({
    props,
    open: false,
    query: '',
    selected: '',
    listId: `workspace-commands-${randomId()}`,
  })
  let focusFrame = 0
  const matches = () =>
    filterWorkspaceCommands(owner.read().props.items, owner.read().query).slice(0, 80)
  const open = () => {
    if (owner.read().props.available)
      owner.patch({ open: true, query: '', selected: owner.read().props.items[0]?.id ?? '' })
  }
  owner.own(onWorkspaceCommands(open))
  owner.own({ dispose: () => cancelAnimationFrame(focusFrame) })
  const actions = {
    open,
    close: () => owner.patch({ open: false }),
    query: (query: string) => {
      owner.patch({ query })
      owner.patch({ selected: matches()[0]?.id ?? '' })
    },
    select: (selected: string) => owner.patch({ selected }),
    move: (offset: number) => {
      const items = matches(),
        index = items.findIndex((item) => item.id === owner.read().selected)
      owner.patch({
        selected: items[(Math.max(0, index) + offset + items.length) % items.length]?.id ?? '',
      })
    },
    edge: (last: boolean) =>
      owner.patch({ selected: (last ? matches().at(-1) : matches()[0])?.id ?? '' }),
    run: (id?: string) => {
      const item = matches().find((item) => item.id === (id ?? owner.read().selected))
      if (!item || item.disabled) return
      owner.patch({ open: false })
      item.run()
      cancelAnimationFrame(focusFrame)
      if (item.focusWindowId) {
        const windowId = item.focusWindowId
        let attempts = 0,
          focusedRoot: HTMLElement | null = null
        const focus = () => {
          const root = document.querySelector<HTMLElement>(
            `[data-workspace-content-id="${CSS.escape(windowId)}"]`,
          )
          if (focusedRoot && document.activeElement !== focusedRoot) return
          if (root && root.getClientRects().length && !root.closest('[aria-hidden="true"]')) {
            const editor = [
              ...root.querySelectorAll<HTMLElement>(
                '.cm-content[tabindex], [contenteditable="true"], textarea:not([disabled]), [role="textbox"]',
              ),
            ].find((element) => element.getClientRects().length)
            if (editor) {
              editor.focus({ preventScroll: true })
              return
            }
            root.focus({ preventScroll: true })
            focusedRoot = root
          }
          if (++attempts < 180) focusFrame = requestAnimationFrame(focus)
        }
        focusFrame = requestAnimationFrame(focus)
      }
    },
  }
  return {
    source: owner.source,
    ...actions,
    receive: (props: Props) => {
      if (!props.available) cancelAnimationFrame(focusFrame)
      owner.patch({ props, ...(!props.available ? { open: false } : {}) })
      if (owner.read().open && !matches().some((item) => item.id === owner.read().selected))
        owner.patch({ selected: matches()[0]?.id ?? '' })
    },
    lifetime: owner,
  }
}
type Model = ControllerModel<typeof controller>
function shortcut(_element: HTMLSpanElement, current: () => Model) {
  const key = (event: KeyboardEvent) => {
    if (!current().props.available || event.defaultPrevented || event.altKey || event.repeat) return
    if (
      !((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') &&
      event.key !== 'F1'
    )
      return
    if (!current().open && document.querySelector('[role="dialog"][aria-modal="true"]')) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (current().open) current().actions.close()
    else current().actions.open()
  }
  window.addEventListener('keydown', key, true)
  return () => window.removeEventListener('keydown', key, true)
}
function selectedVisible(element: HTMLDivElement, current: () => string, lifetime: DomLifetime) {
  let previous = ''
  lifetime.measure({
    read: () => current(),
    write: (selected) => {
      if (selected === previous) return
      previous = selected
      element
        .querySelector<HTMLElement>(`[data-command-id="${CSS.escape(selected)}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    },
  })
}
export const WorkspaceCommands = controllerView(
  { controller },
  view((model) => {
    const all = filterWorkspaceCommands(model.props.items, model.query),
      items = all.slice(0, 80)
    const selectedIndex = items.findIndex((item) => item.id === model.selected)
    return (
      <>
        <span hidden use={domBinding(model, shortcut)} />
        {model.open ? (
          <Portal>
            <div
              class='fixed inset-0 z-[1000002] flex items-start justify-center bg-black/50 p-4 pt-[min(12vh,6rem)]'
              onClick={(event) => {
                if (event.target === event.currentTarget) model.actions.close()
              }}
            >
              <section
                role='dialog'
                aria-modal='true'
                aria-label='Workspace commands'
                class='flex max-h-[min(38rem,80dvh)] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl'
                use={modalFocus({ onEscape: model.actions.close })}
              >
                <header class='flex shrink-0 items-center gap-2 border-b border-border p-3'>
                  <input
                    autofocus
                    role='combobox'
                    aria-label='Find a window or command'
                    aria-autocomplete='list'
                    aria-expanded='true'
                    aria-controls={model.listId}
                    aria-activedescendant={
                      selectedIndex < 0 ? undefined : `${model.listId}-${model.selected}`
                    }
                    class='min-w-0 flex-1 bg-transparent px-1 py-1 text-sm outline-none'
                    placeholder='Find a window or command…'
                    value={model.query}
                    onInput={(event) => model.actions.query(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.isComposing) return
                      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault()
                        model.actions.move(event.key === 'ArrowDown' ? 1 : -1)
                      } else if (event.key === 'Enter') {
                        event.preventDefault()
                        model.actions.run()
                      } else if (
                        (event.ctrlKey || event.metaKey) &&
                        (event.key === 'Home' || event.key === 'End')
                      ) {
                        event.preventDefault()
                        model.actions.edge(event.key === 'End')
                      }
                    }}
                  />
                  <button
                    type='button'
                    aria-label='Close workspace commands'
                    class='rounded border border-border px-2 py-1 text-xs text-muted-foreground'
                    onClick={model.actions.close}
                  >
                    Esc
                  </button>
                </header>
                <div
                  id={model.listId}
                  role='listbox'
                  aria-label='Open windows and commands'
                  class='min-h-0 flex-1 overflow-y-auto p-1'
                  use={domBinding(model.selected, selectedVisible)}
                >
                  {list(
                    items,
                    (item) => item.id,
                    (item) => (
                      <div
                        role='option'
                        id={`${model.listId}-${item.id}`}
                        data-command-id={item.id}
                        aria-selected={item.id === model.selected}
                        aria-disabled={item.disabled || undefined}
                        class={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ${item.id === model.selected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'} ${item.disabled ? 'opacity-45' : ''}`}
                        onPointerMove={() => model.actions.select(item.id)}
                        onClick={() => model.actions.run(item.id)}
                      >
                        <div class='min-w-0 flex-1'>
                          <div class='truncate text-sm'>{item.label}</div>
                          {item.detail ? (
                            <div class='truncate text-xs text-muted-foreground'>{item.detail}</div>
                          ) : null}
                        </div>
                        <span class='shrink-0 text-xs text-muted-foreground'>
                          {item.active ? 'Active' : item.group === 'Windows' ? 'Window' : 'Command'}
                        </span>
                      </div>
                    ),
                  )}
                  {!items.length ? (
                    <p class='px-3 py-8 text-center text-sm text-muted-foreground'>
                      No matching windows or commands.
                    </p>
                  ) : null}
                </div>
                <footer class='flex shrink-0 flex-wrap justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground'>
                  <span>
                    {all.length > 80
                      ? `Showing 80 of ${all.length}. Type to narrow the list.`
                      : `${all.length} results`}
                  </span>
                  <span>↑ ↓ select · Enter open · Ctrl/⌘+Shift+P</span>
                </footer>
              </section>
            </div>
          </Portal>
        ) : null}
      </>
    )
  }),
)
