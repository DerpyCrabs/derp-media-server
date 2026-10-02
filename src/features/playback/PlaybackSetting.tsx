import { collection, domMount, list, component, view } from 'effectweb'
import Check from '@effectweb/lucide/icons/check'
import ChevronDown from '@effectweb/lucide/icons/chevron-down'
import { FloatingContextMenu } from '@/features/explorer/FloatingContextMenu'
import { FLOATING_Z_PLAYBACK_MENU } from '@/lib/ui/floating-z-index'
type Option = { value: string; label: string; disabled?: boolean }
type Props = {
  label: string
  value: string
  options: readonly Option[]
  disabled?: boolean
  mount?: HTMLElement
  onChange: (value: string) => void
}
const focusSelected = domMount((element: HTMLDivElement) => {
  ;(
    element.querySelector<HTMLButtonElement>('button[aria-checked="true"]:not(:disabled)') ??
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')
  )?.focus()
})
const options = collection<Option>((option) => option.value)
export const PlaybackSetting = component<
  Props,
  { open: boolean; anchor: HTMLButtonElement | null }
>(
  { init: () => ({ open: false, anchor: null }) },
  view((model, patch) => {
    const props = model.props
    const close = () => {
      patch({ open: false })
      model.anchor?.focus()
    }
    const navigate = (event: KeyboardEvent & { currentTarget: HTMLDivElement }) => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        if (event.key === 'Escape') event.preventDefault()
        event.stopPropagation()
        close()
        return
      }
      const items = [
        ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
      ]
      const current = items.indexOf(document.activeElement as HTMLButtonElement)
      const next =
        event.key === 'ArrowDown'
          ? items[(current + 1) % items.length]
          : event.key === 'ArrowUp'
            ? items[(current - 1 + items.length) % items.length]
            : event.key === 'Home'
              ? items[0]
              : event.key === 'End'
                ? items.at(-1)
                : event.key.length === 1 && !event.ctrlKey && !event.metaKey && event.key !== ' '
                  ? items.find((item) =>
                      item.textContent?.trim().toLowerCase().startsWith(event.key.toLowerCase()),
                    )
                  : undefined
      if (next) {
        event.preventDefault()
        next.focus()
      }
    }
    return (
      <>
        <button
          type='button'
          aria-label={props.label}
          aria-haspopup='menu'
          aria-expanded={model.open ? 'true' : 'false'}
          disabled={props.disabled}
          class='border-input bg-background hover:bg-accent flex h-9 w-full min-w-0 items-center gap-2 rounded-md border px-2 text-left text-sm disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ring'
          onClick={(event) => patch({ open: !model.open, anchor: event.currentTarget })}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              patch({ open: true, anchor: event.currentTarget })
            }
          }}
        >
          <span class='min-w-0 flex-1 truncate'>
            {props.options.find((option) => option.value === props.value)?.label}
          </span>
          <ChevronDown class='text-muted-foreground h-3.5 w-3.5 shrink-0' />
        </button>
        <FloatingContextMenu
          open={model.open}
          anchorRef={model.anchor}
          onDismiss={() => patch({ open: false })}
          mount={props.mount}
          zIndex={FLOATING_Z_PLAYBACK_MENU}
          class='max-h-[min(60dvh,320px)] w-80 max-w-[calc(100vw-1rem)] overflow-y-auto'
        >
          <div use={focusSelected} onKeyDown={navigate}>
            {list(options.from(props.options), (option) => (
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
                {option.value === props.value ? <Check class='h-4 w-4 shrink-0' /> : null}
              </button>
            ))}
          </div>
        </FloatingContextMenu>
      </>
    )
  }),
)
