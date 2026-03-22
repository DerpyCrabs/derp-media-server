import { For, Show, createEffect, createMemo, createSignal, untrack, type JSX } from 'solid-js'
import { getSolidIconComponent, SOLID_AVAILABLE_ICONS } from '../lib/solid-available-icons'
import X from 'lucide-solid/icons/x'

type Props = {
  isOpen: boolean
  fileName: string
  currentIcon: string | null
  onClose: () => void
  onSave: (iconName: string | null) => void
  isPending?: boolean
}

export function IconEditorDialog(props: Props) {
  const [selectedIcon, setSelectedIcon] = createSignal<string | null>(
    untrack(() => props.currentIcon),
  )

  createEffect(() => {
    if (props.isOpen) setSelectedIcon(props.currentIcon)
  })

  function handleSave() {
    props.onSave(selectedIcon())
    props.onClose()
  }

  function handleRemove() {
    props.onSave(null)
    props.onClose()
  }

  const previewEl = createMemo((): JSX.Element => {
    const n = selectedIcon()
    if (!n) return <span class='text-xs text-muted-foreground'>None</span>
    const I = getSolidIconComponent(n)
    return I ? (
      <I class='h-6 w-6 text-primary' size={24} />
    ) : (
      <span class='text-xs text-muted-foreground'>None</span>
    )
  })

  return (
    <Show when={props.isOpen}>
      <div
        class='fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4'
        role='presentation'
        onClick={() => props.onClose()}
      >
        <div
          data-slot='dialog-content'
          role='dialog'
          aria-modal='true'
          class='max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg'
          onClick={(e) => e.stopPropagation()}
        >
          <h2 class='text-lg font-semibold'>Set Custom Icon</h2>
          <p class='mt-1 text-sm text-muted-foreground'>
            Choose an icon for <span class='font-semibold'>{props.fileName}</span>
          </p>

          <div class='mt-4 flex items-center gap-3 rounded-lg border bg-muted/30 p-4'>
            <div class='flex h-12 w-12 items-center justify-center rounded-lg border bg-background'>
              {previewEl()}
            </div>
            <div class='min-w-0 flex-1'>
              <p class='text-sm font-medium'>{props.fileName}</p>
              <p class='text-xs text-muted-foreground'>
                {selectedIcon() ? `Icon: ${selectedIcon()}` : 'No custom icon'}
              </p>
            </div>
          </div>

          <div class='mt-4 flex flex-col gap-4'>
            <button
              type='button'
              class='flex h-9 w-full items-center justify-center gap-2 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent'
              onClick={() => handleRemove()}
              disabled={props.isPending}
            >
              <X class='h-4 w-4' stroke-width={2} />
              Remove Custom Icon
            </button>

            <div class='grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8'>
              <For each={SOLID_AVAILABLE_ICONS}>
                {(icon) => {
                  const Icon = icon.Icon
                  return (
                    <button
                      type='button'
                      title={icon.name}
                      class={`flex items-center justify-center rounded-lg border-2 p-3 transition-all hover:bg-muted/50 ${
                        selectedIcon() === icon.name
                          ? 'border-primary bg-primary/10'
                          : 'border-border hover:border-primary/50'
                      }`}
                      onClick={() => setSelectedIcon(icon.name)}
                    >
                      <Icon class='h-6 w-6' size={24} stroke-width={2} />
                    </button>
                  )
                }}
              </For>
            </div>
          </div>

          <div class='mt-6 flex justify-end gap-2'>
            <button
              type='button'
              class='h-9 rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent'
              onClick={() => props.onClose()}
              disabled={props.isPending}
            >
              Cancel
            </button>
            <button
              type='button'
              class='h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50'
              disabled={props.isPending || selectedIcon() === props.currentIcon}
              onClick={() => handleSave()}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </Show>
  )
}
