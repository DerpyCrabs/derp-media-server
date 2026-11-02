import { Collapsible } from '@effectweb/shadcn/collapsible'
import ChevronRight from '@effectweb/lucide/icons/chevron-right'
import { view, type JSX } from 'effectweb'
import { cn } from './cn'

export const Disclosure = view<{
  trigger: JSX.Element
  children?: JSX.Element
  class?: string
  triggerClass?: string
  title?: string
  'data-testid'?: string
}>((props) => (
  <div class={props.class} title={props.title} data-testid={props['data-testid']}>
    <Collapsible
      triggerClass={cn(
        'flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 justify-start text-left text-xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        props.triggerClass,
      )}
      trigger={
        <>
          <ChevronRight class='size-3.5 shrink-0 transition-transform group-data-[open]/collapsible:rotate-90' />
          {props.trigger}
        </>
      }
    >
      {props.children}
    </Collapsible>
  </div>
))
