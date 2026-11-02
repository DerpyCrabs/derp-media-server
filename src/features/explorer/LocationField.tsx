import { domMount, view } from 'effectweb'
import { Input } from '@/lib/ui/input'
import { Button } from '@/lib/ui/button'
import X from '@effectweb/lucide/icons/x'
const focusLocation = domMount((element: HTMLInputElement) => {
  element.focus()
  element.select()
})
export const LocationField = view<{
  value: string
  pending: boolean
  error: string
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
}>((props) => (
  <form
    class='w-full min-w-0'
    onSubmit={(event) => {
      event.preventDefault()
      props.onSubmit()
    }}
  >
    <div class='relative'>
      <Input
        use={focusLocation}
        aria-label='Location'
        value={props.value}
        disabled={props.pending}
        aria-invalid={!!props.error}
        class='pr-8'
        onInput={(event) => props.onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            props.onCancel()
          }
        }}
      />
      <Button
        variant='ghost'
        size='icon-sm'
        class='absolute right-0.5 top-0.5'
        aria-label='Cancel location'
        onClick={props.onCancel}
      >
        <X />
      </Button>
    </div>
    {props.error ? (
      <p role='alert' class='mt-1 text-xs text-destructive'>
        {props.error}
      </p>
    ) : null}
  </form>
))
