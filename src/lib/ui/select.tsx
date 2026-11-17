import { Select as ShadcnSelect, type SelectProps } from '@effectweb/shadcn/select'
import { controllerView, modelOwner, ownerController, view } from 'effectweb'
import { cn } from './cn'
export type { SelectProps, SelectOption } from '@effectweb/shadcn/select'
export const Select = controllerView(
  {
    controller: (props: SelectProps) => {
      const owner = modelOwner({ props, open: props.open ?? props.defaultOpen ?? false })
      return {
        ...ownerController(owner),
        open: (open: boolean) => {
          owner.patch({ open })
          owner.read().props.onOpenChange?.(open)
        },
        choose: (value: string) => {
          owner.patch({ open: false })
          owner.read().props.onOpenChange?.(false)
          owner.read().props.onValueChange?.(value)
        },
      }
    },
  },
  view((model) => (
    <span class='min-w-0 flex-1 [&>[data-slot=select]]:block'>
      <ShadcnSelect
        {...model.props}
        class={cn('w-full', model.props.class)}
        open={model.props.open ?? model.open}
        onOpenChange={model.actions.open}
        onValueChange={model.actions.choose}
      />
    </span>
  )),
)
