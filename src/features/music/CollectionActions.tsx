import { createSignal } from 'solid-js'
import { Ellipsis, Radio } from 'lucide-solid'
import { FloatingContextMenu } from '@/features/explorer/FloatingContextMenu'

export function CollectionActions(props: {
  label: string
  disabled?: boolean
  onRadio: () => void
}) {
  const [menu, setMenu] = createSignal<{ x: number; y: number }>()
  const action =
    'flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm hover:bg-secondary'
  return (
    <>
      <button
        aria-label={`Options for ${props.label}`}
        aria-haspopup='menu'
        aria-expanded={menu() ? 'true' : 'false'}
        disabled={props.disabled}
        class='grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40'
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          setMenu({ x: box.right - 200, y: box.bottom })
        }}
      >
        <Ellipsis size={19} />
      </button>
      <FloatingContextMenu
        state={menu}
        anchor={(value) => value}
        onDismiss={() => setMenu(undefined)}
        role='menu'
        class='w-52'
      >
        {() => (
          <>
            <button
              class={action}
              onClick={() => {
                setMenu(undefined)
                props.onRadio()
              }}
            >
              <Radio size={16} />
              Start radio
            </button>
          </>
        )}
      </FloatingContextMenu>
    </>
  )
}
