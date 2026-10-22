import { component, view, domBinding, list, observe } from 'effectweb'
import ChevronDown from '@effectweb/lucide/icons/chevron-down'
import Check from '@effectweb/lucide/icons/check'
import { FloatingContextMenu } from '@/features/explorer/FloatingContextMenu'
import type { PickerRequest } from './bridge'
import type { Picker } from './picker-controller'
const PickerChoice = component<
  {
    label: string
    value: string
    options: { id: string; label: string }[]
    onChange: (value: string) => void
  },
  { open: boolean; anchor: HTMLDivElement | null }
>(
  { init: () => ({ open: false, anchor: null }) },
  view((local, patch) => {
    const props = local.props
    const open = (): boolean => local.open as boolean
    const setOpen = (value: boolean | ((current: boolean) => boolean)) => {
      patch({ open: typeof value === 'function' ? value(open()) : value })
    }
    const anchor = (): HTMLDivElement | null => local.anchor as HTMLDivElement | null
    return (
      <div class='relative' use={{ ...domBinding(patch, pickerAnchor), identity: patch }}>
        <button
          type='button'
          aria-label={props.label}
          aria-expanded={open() ? 'true' : 'false'}
          onClick={() => {
            setOpen(!open())
          }}
          class='inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent'
        >
          <span>{props.options.find((item) => item.id === props.value)?.label ?? props.label}</span>
          <ChevronDown class='size-4' />
        </button>
        <FloatingContextMenu
          open={open()}
          anchorRef={anchor()}
          onDismiss={() => setOpen(false)}
          minWidthMin={180}
          class='max-h-64 overflow-y-auto'
        >
          {list(
            props.options,
            (item) => item.id,
            (item) => (
              <button
                type='button'
                role='menuitemradio'
                aria-checked={item.id === props.value ? 'true' : 'false'}
                class='flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground'
                onClick={() => {
                  props.onChange(item.id)
                  setOpen(false)
                }}
              >
                <span class='w-4'>{item.id === props.value ? <Check class='size-4' /> : null}</span>
                {item.label}
              </button>
            ),
          )}
        </FloatingContextMenu>
      </div>
    )
  }),
)
export const PickerControls = view<{ request: PickerRequest; picker: Picker; cancel: () => void }>(
  (props) =>
    observe(props.picker.source, (state) => {
      const acceptLabel = () =>
        props.request.acceptLabel ||
        (props.request.mode === 'SaveFile'
          ? 'Save'
          : props.request.directory
            ? 'Select folder'
            : 'Open')
      return (
        <form
          class='shrink-0 space-y-2 border-t border-border bg-background p-3'
          onSubmit={(event) => {
            event.preventDefault()
            props.picker.accept()
          }}
          aria-label='File picker'
        >
          {props.request.mode === 'SaveFile' ? (
            <label class='flex items-center gap-3 text-sm'>
              Name
              <input
                aria-label='File name'
                class='h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
                value={state.name}
                onInput={(event) => {
                  props.picker.setName(event.currentTarget.value)
                }}
              />
            </label>
          ) : null}
          <div class='flex flex-wrap items-center gap-2'>
            {props.request.filters.length > 0 ? (
              <PickerChoice
                label='File type'
                value={String(state.filter)}
                options={props.request.filters.map((item, index) => ({
                  id: String(index),
                  label: item.name,
                }))}
                onChange={(value) => props.picker.setFilter(Number(value))}
              />
            ) : null}
            {list(
              props.request.choices,
              (choice) => choice.id,
              (choice) => (
                <PickerChoice
                  label={choice.label}
                  value={state.choices[choice.id] ?? ''}
                  options={
                    choice.options.length
                      ? choice.options
                      : [
                          { id: 'true', label: `${choice.label}: Yes` },
                          { id: 'false', label: `${choice.label}: No` },
                        ]
                  }
                  onChange={(value) => props.picker.setChoice(choice.id, value)}
                />
              ),
            )}
            <span class='mr-auto text-sm text-muted-foreground' role='status'>
              {state.selected.length
                ? `${state.selected.length} selected`
                : props.request.directory
                  ? 'Choose a folder'
                  : ''}
            </span>
            <button
              type='button'
              class='h-9 rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent'
              onClick={() => {
                props.cancel()
              }}
            >
              Cancel
            </button>
            <button
              type='submit'
              disabled={state.pending}
              class='h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50'
            >
              {acceptLabel()}
            </button>
          </div>
          {state.error ? (
            <p role='alert' class='text-sm text-destructive'>
              {state.error}
            </p>
          ) : null}
        </form>
      )
    }),
)
const pickerAnchor = (
  element: HTMLDivElement,
  current: () => (fields: { anchor: HTMLDivElement | null }) => void,
) => {
  current()({ anchor: element })
  return () => current()({ anchor: null })
}
