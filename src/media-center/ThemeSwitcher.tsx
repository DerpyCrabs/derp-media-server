import { cn } from '@/lib/ui/cn'
import Settings from 'lucide-solid/icons/settings'
import { Show, createEffect, createSignal } from 'solid-js'
import { Portal } from '@solidjs/web'
import { ThemeSwitcherMenuContent } from './ThemeSwitcherMenuContent'

type Props = { variant?: 'header' | 'floating' }

export function ThemeSwitcher(props: Props) {
  const variant = () => props.variant ?? 'header'
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [menuPosition, setMenuPosition] = createSignal({
    top: 0,
    right: 8,
    bottom: 0,
    maxHeight: 1,
  })
  let trigger: HTMLButtonElement | undefined

  function updateMenuPosition() {
    const rect = trigger?.getBoundingClientRect()
    if (!rect) return
    const viewport = window.visualViewport
    const viewportTop = viewport?.offsetTop ?? 0
    const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight)
    const top = Math.max(viewportTop + 8, rect.bottom + 4)
    const bottom = Math.max(
      window.innerHeight - viewportBottom + 8,
      window.innerHeight - rect.top + 4,
    )
    setMenuPosition({
      top,
      right: Math.max(8, window.innerWidth - rect.right),
      bottom,
      maxHeight:
        variant() === 'floating'
          ? Math.max(1, rect.top - viewportTop - 12)
          : Math.max(1, viewportBottom - top - 8),
    })
  }

  function toggleMenu() {
    if (!menuOpen()) updateMenuPosition()
    setMenuOpen(!menuOpen())
  }

  createEffect(
    () => menuOpen(),
    (isOpen) => {
      if (!isOpen) return undefined
      const update = () => updateMenuPosition()
      window.addEventListener('resize', update)
      window.addEventListener('scroll', update, true)
      window.visualViewport?.addEventListener('resize', update)
      window.visualViewport?.addEventListener('scroll', update)
      // eslint-disable-next-line solid/reactivity
      return () => {
        window.removeEventListener('resize', update)
        window.removeEventListener('scroll', update, true)
        window.visualViewport?.removeEventListener('resize', update)
        window.visualViewport?.removeEventListener('scroll', update)
      }
    },
  )

  return (
    <div class={cn('relative', variant() === 'floating' && 'fixed bottom-4 right-4 z-10002')}>
      <button
        ref={(element) => {
          trigger = element
        }}
        type='button'
        title='Theme settings'
        aria-label='Open theme settings'
        aria-expanded={menuOpen() ? 'true' : 'false'}
        class='inline-flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-input/50 aria-expanded:bg-muted aria-expanded:text-foreground'
        onClick={toggleMenu}
      >
        <Settings class='h-4 w-4' stroke-width={2} aria-hidden='true' />
      </button>
      <Show when={menuOpen()}>
        <Portal>
          <div
            class='fixed inset-0 z-10000'
            role='presentation'
            onClick={() => setMenuOpen(false)}
          />
          <div
            data-testid='theme-settings-menu'
            role='menu'
            aria-label='Theme settings'
            class={[
              'ring-foreground/10 fixed z-10001 min-w-44 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-md bg-popover p-1 text-popover-foreground shadow-md ring-1',
              {
                'origin-bottom-right': variant() === 'floating',
                'origin-top-right': variant() !== 'floating',
              },
            ]}
            style={{
              right: `${menuPosition().right}px`,
              ...(variant() === 'floating'
                ? {
                    bottom: `${menuPosition().bottom}px`,
                    'max-height': `${menuPosition().maxHeight}px`,
                  }
                : {
                    top: `${menuPosition().top}px`,
                    'max-height': `${menuPosition().maxHeight}px`,
                  }),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <ThemeSwitcherMenuContent onAfterPick={() => setMenuOpen(false)} />
          </div>
        </Portal>
      </Show>
    </div>
  )
}
