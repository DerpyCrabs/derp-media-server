import { cn } from '@/lib/ui/cn'
import Settings from '@effectweb/lucide/icons/settings'
import { domBinding, localComponent, Portal, view } from 'effectweb'
import { ThemeSwitcherMenuContent } from './ThemeSwitcherMenuContent'
type Props = { variant?: 'header' | 'floating'; compact?: boolean }
const positionMenu = (
  element: HTMLDivElement,
  data: () => { anchor: HTMLButtonElement | null; variant: string },
) => {
  const update = () => {
    const rect = data().anchor?.getBoundingClientRect()
    if (!rect) return
    const viewport = window.visualViewport
    const viewportTop = viewport?.offsetTop ?? 0
    const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight)
    const top = Math.max(viewportTop + 8, rect.bottom + 4)
    const bottom = Math.max(
      window.innerHeight - viewportBottom + 8,
      window.innerHeight - rect.top + 4,
    )
    const floating = data().variant === 'floating'
    Object.assign(element.style, {
      right: `${Math.max(8, window.innerWidth - rect.right)}px`,
      top: floating ? '' : `${top}px`,
      bottom: floating ? `${bottom}px` : '',
      maxHeight: `${floating ? Math.max(1, rect.top - viewportTop - 12) : Math.max(1, viewportBottom - top - 8)}px`,
    })
  }
  window.addEventListener('resize', update)
  window.addEventListener('scroll', update, true)
  window.visualViewport?.addEventListener('resize', update)
  window.visualViewport?.addEventListener('scroll', update)
  update()
  return {
    update,
    dispose() {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
    },
  }
}
export const ThemeSwitcher = localComponent<
  Props,
  { open: boolean; anchor: HTMLButtonElement | null }
>({
  init: () => ({ open: false, anchor: null }),
  view: view(({ props, open, anchor }, patch) => {
    const variant = props.variant ?? 'header'
    return (
      <div class={cn('relative', variant === 'floating' && 'fixed bottom-4 right-4 z-10002')}>
        <button
          type='button'
          title='Theme settings'
          aria-label='Open theme settings'
          aria-expanded={open ? 'true' : 'false'}
          class={cn(
            'inline-flex shrink-0 items-center justify-center text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-input/50 aria-expanded:bg-muted aria-expanded:text-foreground',
            props.compact ? 'h-7 w-7' : 'size-8 rounded-md',
          )}
          onClick={(event) => patch({ open: !open, anchor: event.currentTarget })}
        >
          <Settings
            class={props.compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}
            stroke-width={2}
            aria-hidden='true'
          />
        </button>
        {open ? (
          <Portal>
            <div
              class='fixed inset-0 z-10000'
              role='presentation'
              onClick={() => patch({ open: false })}
            />
            <div
              use={domBinding({ anchor, variant }, positionMenu)}
              data-testid='theme-settings-menu'
              role='menu'
              aria-label='Theme settings'
              class={cn(
                'ring-foreground/10 fixed z-10001 min-w-44 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-md bg-popover p-1 text-popover-foreground shadow-md ring-1',
                variant === 'floating' ? 'origin-bottom-right' : 'origin-top-right',
              )}
              onClick={(event) => event.stopPropagation()}
            >
              <ThemeSwitcherMenuContent onAfterPick={() => patch({ open: false })} />
            </div>
          </Portal>
        ) : null}
      </div>
    )
  }),
})
