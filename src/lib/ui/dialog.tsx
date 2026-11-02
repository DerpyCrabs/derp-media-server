import { Dialog as ShadcnDialog, type DialogProps } from '@effectweb/shadcn/dialog'
import { view } from 'effectweb'
import { cn } from './cn'
export {
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  type DialogProps,
} from '@effectweb/shadcn/dialog'

export const Dialog = view<DialogProps>((props) => (
  <ShadcnDialog {...props} class={cn('grid-cols-1', props.class)} />
))
