import { cn } from '@/lib/utils'
import Settings from 'lucide-solid/icons/settings'
import { Show, createSignal } from 'solid-js'
import { ThemeSwitcherMenuContent } from './ThemeSwitcherMenuContent'
import { MountsDialog } from './MountsDialog'
import FolderCog from 'lucide-solid/icons/folder-cog'

type Props = { variant?: 'header' | 'floating' }

export function ThemeSwitcher(props: Props) {
  const variant = () => props.variant ?? 'header'
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [mountsOpen, setMountsOpen] = createSignal(false)

  return (
    <div class={cn('relative', variant() === 'floating' && 'fixed bottom-4 right-4 z-10002')}>
      <button
        type='button'
        title='Theme settings'
        aria-label='Open theme settings'
        aria-expanded={menuOpen()}
        class='inline-flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-input/50 aria-expanded:bg-muted aria-expanded:text-foreground'
        onClick={() => setMenuOpen(!menuOpen())}
      >
        <Settings class='h-4 w-4' stroke-width={2} aria-hidden='true' />
      </button>
      <Show when={menuOpen()}>
        <div class='fixed inset-0 z-10000' role='presentation' onClick={() => setMenuOpen(false)} />
        <div
          class={cn(
            'ring-foreground/10 absolute right-0 z-10001 min-w-44 overflow-hidden rounded-md bg-popover p-1 text-popover-foreground shadow-md ring-1',
            variant() === 'floating'
              ? 'bottom-full mb-1 origin-bottom-right'
              : 'top-full mt-1 origin-top-right',
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <ThemeSwitcherMenuContent onAfterPick={() => setMenuOpen(false)} />
          <div class='bg-border my-1 h-px' />
          <button
            type='button'
            class='hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm'
            onClick={() => {
              setMenuOpen(false)
              setMountsOpen(true)
            }}
          >
            <FolderCog class='size-4' />
            Media directories
          </button>
        </div>
      </Show>
      <MountsDialog open={mountsOpen()} onClose={() => setMountsOpen(false)} />
    </div>
  )
}
