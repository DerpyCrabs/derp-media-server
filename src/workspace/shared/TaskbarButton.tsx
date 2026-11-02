import { view } from 'effectweb'
import { Button, type ButtonProps } from '@/lib/ui/button'
import { cn } from '@/lib/ui/cn'

export const TaskbarButton = view<ButtonProps>((props) => (
  <Button
    {...props}
    variant='ghost'
    class={cn(
      'h-auto rounded-none border-0 bg-transparent p-0 font-normal active:translate-y-0',
      props.class,
    )}
  />
))
