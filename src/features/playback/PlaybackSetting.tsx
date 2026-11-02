import FolderOpen from '@effectweb/lucide/icons/folder-open'
import { view } from 'effectweb'
import { Select } from '@/lib/ui/select'
import { Button } from '@/lib/ui/button'
type Option = { value: string; label: string; disabled?: boolean }
type Props = {
  label: string
  value: string
  options: readonly Option[]
  disabled?: boolean
  status?: string
  mount?: HTMLElement
  action?: { label: string; onClick: () => void }
  onChange: (value: string) => void
}
export const PlaybackSetting = view<Props>((props) => (
  <div class='flex min-w-0 items-center gap-2'>
    <Select
      aria-label={props.label}
      value={props.value}
      options={props.options}
      disabled={props.disabled}
      onValueChange={props.onChange}
      class='w-full min-w-0'
    />
    {props.action ? (
      <Button
        variant='outline'
        size='icon'
        aria-label={props.action.label}
        title={props.action.label}
        onClick={props.action.onClick}
      >
        <FolderOpen />
      </Button>
    ) : null}
  </div>
))
