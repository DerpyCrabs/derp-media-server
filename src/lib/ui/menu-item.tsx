import { view } from 'effectweb'
import { Button, type ButtonProps } from './button'
import { cn } from './cn'

export const MenuItem = view<ButtonProps>((props) => (
  <Button
    {...props}
    variant={props.variant ?? 'ghost'}
    role={props.role ?? 'menuitem'}
    class={cn(
      'h-auto min-h-8 w-full min-w-0 justify-start whitespace-normal gap-2 rounded-md px-2 py-1.5 text-left font-normal',
      props.class,
    )}
  />
))
