import { For, Show, createSignal } from 'solid-js'
import Check from 'lucide-solid/icons/check'
import ChevronDown from 'lucide-solid/icons/chevron-down'
import { FloatingContextMenu } from '@/features/explorer/FloatingContextMenu'
import { FLOATING_Z_PLAYBACK_MENU } from '@/lib/ui/floating-z-index'

type Option = { value: string; label: string; disabled?: boolean }

export function PlaybackSetting(props: {
  label: string
  value: string
  options: readonly Option[]
  disabled?: boolean
  mount?: HTMLElement
  onChange: (value: string) => void
}) {
  const [open, setOpen] = createSignal(false)
  const [anchor, setAnchor] = createSignal<HTMLButtonElement | null>(null)
  let menu: HTMLDivElement | undefined

  function close() {
    setOpen(false)
    anchor()?.focus()
  }

  function navigate(event: KeyboardEvent) {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    const items = Array.from(
      menu?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
    )
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    let next: HTMLButtonElement | undefined
    if (event.key === 'ArrowDown') next = items[(current + 1) % items.length]
    else if (event.key === 'ArrowUp') next = items[(current - 1 + items.length) % items.length]
    else if (event.key === 'Home') next = items[0]
    else if (event.key === 'End') next = items.at(-1)
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && event.key !== ' ')
      next = items.find((item) =>
        item.textContent?.trim().toLowerCase().startsWith(event.key.toLowerCase()),
      )
    if (next) {
      event.preventDefault()
      next.focus()
    }
  }

  return (
    <>
      <button
        ref={setAnchor}
        type='button'
        aria-label={props.label}
        aria-haspopup='menu'
        aria-expanded={open() ? 'true' : 'false'}
        disabled={props.disabled}
        class='border-input bg-background hover:bg-accent flex h-9 w-full min-w-0 items-center gap-2 rounded-md border px-2 text-left text-sm disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ring'
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span class='min-w-0 flex-1 truncate'>
          {props.options.find((option) => option.value === props.value)?.label}
        </span>
        <ChevronDown class='text-muted-foreground h-3.5 w-3.5 shrink-0' />
      </button>
      <FloatingContextMenu
        open={open}
        anchorRef={anchor}
        onDismiss={() => setOpen(false)}
        mount={props.mount ?? document.body}
        zIndex={FLOATING_Z_PLAYBACK_MENU}
        class='max-h-[min(60dvh,320px)] w-80 max-w-[calc(100vw-1rem)] overflow-y-auto'
      >
        <div
          ref={(element) => {
            menu = element
            queueMicrotask(() => {
              const selected = element.querySelector<HTMLButtonElement>(
                'button[aria-checked="true"]:not(:disabled)',
              )
              ;(
                selected ?? element.querySelector<HTMLButtonElement>('button:not(:disabled)')
              )?.focus()
            })
          }}
          onKeyDown={navigate}
        >
          <For each={props.options}>
            {(option) => (
              <button
                type='button'
                role='menuitemradio'
                aria-checked={option.value === props.value ? 'true' : 'false'}
                disabled={option.disabled}
                class='hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none disabled:opacity-40'
                onClick={() => {
                  props.onChange(option.value)
                  close()
                }}
              >
                <span class='min-w-0 flex-1'>{option.label}</span>
                <Show when={option.value === props.value}>
                  <Check class='h-4 w-4 shrink-0' />
                </Show>
              </button>
            )}
          </For>
        </div>
      </FloatingContextMenu>
    </>
  )
}
