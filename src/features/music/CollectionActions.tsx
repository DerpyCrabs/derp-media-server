import { view } from 'effectweb'
import { Button } from '@/lib/ui/button'
import { DropdownMenu } from '@/lib/ui/menu'
import Ellipsis from '@effectweb/lucide/icons/ellipsis'
import Radio from '@effectweb/lucide/icons/radio'

type Props = { label: string; disabled?: boolean; onRadio: () => void }
export const CollectionActions = view<Props>((props) => (
  <DropdownMenu
    trigger={
      <Button
        variant='ghost'
        size='icon'
        aria-label={`Options for ${props.label}`}
        disabled={props.disabled}
      >
        <Ellipsis />
      </Button>
    }
    items={[
      { kind: 'item', label: 'Start radio', icon: <Radio size={16} />, onSelect: props.onRadio },
    ]}
  />
))
