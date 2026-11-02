import { restoreOverlayFocus } from './overlay-focus'
import { createPopover } from '@effectweb/base-ui/popover'
import { overlayAnchorBinding } from '@effectweb/base-ui/anchor'
import { PopoverPopup, type PopoverProps as ShadcnPopoverProps } from '@effectweb/shadcn/popover'
import { controllerView, modelOwner, view } from 'effectweb'
import { cn } from './cn'

export type PopoverProps = ShadcnPopoverProps & { 'aria-label'?: string }
export const Popover = controllerView(
  {
    controller: (props: PopoverProps) => {
      const owner = modelOwner({ props })
      const handle = createPopover({
        get open() {
          return owner.read().props.open
        },
        defaultOpen: props.defaultOpen,
        onOpenChange: (open) => owner.read().props.onOpenChange?.(open),
      })
      owner.own(handle.lifetime)
      return {
        source: owner.source,
        handle,
        lifetime: owner,
        receive: (props: PopoverProps) => {
          owner.patch({ props })
          if (props.open !== undefined) handle.sync({ open: props.open })
        },
      }
    },
  },
  view((model) => (
    <span
      data-slot='popover'
      class='inline-block'
      use={overlayAnchorBinding(model.actions.handle)}
      onClick={(event) => {
        if (event.currentTarget.firstElementChild?.contains(event.target as Element))
          model.actions.handle.toggle()
      }}
    >
      {model.props.trigger}
      <PopoverPopup
        popover={model.actions.handle}
        finalFocus={() => restoreOverlayFocus(model.actions.handle)}
        aria-label={model.props['aria-label']}
        side={model.props.side}
        align={model.props.align}
        sideOffset={model.props.sideOffset}
        data-slot='popover-content'
        class={cn('max-w-[calc(100vw-1rem)]', model.props.class)}
      >
        {model.props.children}
      </PopoverPopup>
    </span>
  )),
)
