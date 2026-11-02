import { Button } from '@/lib/ui/button'
import { component, view, list, type JSX } from 'effectweb'
import { getIconComponent, AVAILABLE_ICONS } from '@/lib/ui/available-icons'
import X from '@effectweb/lucide/icons/x'
import type { ModalOverlayScope } from './modal-overlay-scope'
import { Dialog } from '@/lib/ui/dialog'
type Props = {
  overlayScope?: ModalOverlayScope
  isOpen: boolean
  fileName: string
  currentIcon: string | null
  onClose: () => void
  onSave: (iconName: string | null) => void
  isPending?: boolean
}
export const IconEditorDialog = component(
  {
    init: (_props: Props) => ({
      selection: { key: '', icon: null } as { key: string; icon: string | null },
    }),
  },
  view((local, patch) => {
    const props = local.props
    const selection = () => local.selection,
      setSelection = (value: { key: string; icon: string | null }) => patch({ selection: value })
    const selectionKey = () => `${props.fileName}\0${props.currentIcon ?? ''}`
    const selectedIcon = () =>
      selection().key === selectionKey() ? selection().icon : props.currentIcon
    const setSelectedIcon = (icon: string | null) => setSelection({ key: selectionKey(), icon })
    function close() {
      setSelection({ key: '', icon: null })
      props.onClose()
    }
    function handleSave() {
      props.onSave(selectedIcon())
      close()
    }
    function handleRemove() {
      props.onSave(null)
      close()
    }
    const previewEl = (): JSX.Element => {
      const n = selectedIcon()
      if (!n) return <span class='text-xs text-muted-foreground'>None</span>
      const I = getIconComponent(n)
      return I ? (
        <I class='h-6 w-6 text-primary' size={24} />
      ) : (
        <span class='text-xs text-muted-foreground'>None</span>
      )
    }
    return props.isOpen ? (
      <Dialog
        open
        title='Set Custom Icon'
        onOpenChange={(open) => {
          if (!open) close()
        }}
        class='sm:max-w-2xl max-h-[85dvh] overflow-y-auto'
      >
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
          <Button
            variant='outline'
            type='button'
            class='flex h-9 w-full items-center justify-center gap-2 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent'
            onClick={() => handleRemove()}
            disabled={props.isPending}
          >
            <X class='size-4' stroke-width={2} />
            Remove Custom Icon
          </Button>

          <div class='grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8'>
            {list(
              AVAILABLE_ICONS,
              (icon) => icon.name,
              (icon) => {
                const Icon = icon.Icon
                return (
                  <Button
                    variant='outline'
                    size='icon-lg'
                    type='button'
                    title={icon.name}
                    class={`flex items-center justify-center rounded-lg border-2 p-3 transition-all hover:bg-muted/50 ${
                      selectedIcon() === icon.name
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/50'
                    }`}
                    onClick={() => setSelectedIcon(icon.name)}
                  >
                    <Icon class='size-6' size={24} stroke-width={2} />
                  </Button>
                )
              },
            )}
          </div>
        </div>

        <div class='mt-6 flex justify-end gap-2'>
          <Button
            variant='outline'
            type='button'
            class='h-9 rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent'
            onClick={close}
            disabled={props.isPending}
          >
            Cancel
          </Button>
          <Button
            variant='default'
            type='button'
            class='h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50'
            disabled={props.isPending || selectedIcon() === props.currentIcon}
            onClick={() => handleSave()}
          >
            Save
          </Button>
        </div>
      </Dialog>
    ) : null
  }),
)
