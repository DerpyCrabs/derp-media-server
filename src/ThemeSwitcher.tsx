import { useThemeStore, type ThemeMode, type ThemePalette } from '@/lib/theme-store'
import { applyTheme, resolveTheme } from '@/lib/theme-dom'
import { cn } from '@/lib/utils'
import Check from 'lucide-solid/icons/check'
import Monitor from 'lucide-solid/icons/monitor'
import Moon from 'lucide-solid/icons/moon'
import Settings from 'lucide-solid/icons/settings'
import Sun from 'lucide-solid/icons/sun'
import { For, Show, createSignal } from 'solid-js'
import { useStoreSync } from './lib/solid-store-sync'

const MODES: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

const PALETTES: { value: ThemePalette; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'caffeine', label: 'Caffeine' },
  { value: 'cosmic-night', label: 'Cosmic Night' },
]

type Props = { variant?: 'header' | 'floating' }

export function ThemeSwitcher(props: Props) {
  const variant = () => props.variant ?? 'header'
  const [menuOpen, setMenuOpen] = createSignal(false)
  const storeTick = useStoreSync(useThemeStore)

  const palette = () => {
    void storeTick()
    return useThemeStore.getState().palette
  }
  const mode = () => {
    void storeTick()
    return useThemeStore.getState().mode
  }

  function setTheme(p: ThemePalette, m: ThemeMode) {
    useThemeStore.getState().setTheme(p, m)
    applyTheme(resolveTheme(p, m))
  }

  return (
    <div class={cn('relative', variant() === 'floating' && 'fixed bottom-4 right-4 z-10002')}>
      <button
        type='button'
        title='Theme settings'
        aria-label='Open theme settings'
        aria-expanded={menuOpen()}
        class='inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-sm font-medium shadow-xs transition-colors hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 aria-expanded:bg-muted aria-expanded:text-foreground'
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
          <div class='text-muted-foreground px-2 py-1.5 text-xs font-medium'>Mode</div>
          <For each={MODES}>
            {(m) => {
              const Icon = m.icon
              const active = () => mode() === m.value
              return (
                <button
                  type='button'
                  role='menuitem'
                  class='hover:bg-accent hover:text-accent-foreground flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none'
                  onClick={() => {
                    setTheme(palette(), m.value)
                    setMenuOpen(false)
                  }}
                >
                  <Icon class='h-4 w-4 shrink-0' stroke-width={2} />
                  <span class='flex-1'>{m.label}</span>
                  <Show when={active()}>
                    <Check class='h-4 w-4 shrink-0' stroke-width={2} />
                  </Show>
                </button>
              )
            }}
          </For>
          <div class='bg-border my-1 h-px' />
          <div class='text-muted-foreground px-2 py-1.5 text-xs font-medium'>Theme</div>
          <For each={PALETTES}>
            {(p) => {
              const active = () => palette() === p.value
              return (
                <button
                  type='button'
                  role='menuitem'
                  class='hover:bg-accent hover:text-accent-foreground flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none'
                  onClick={() => {
                    setTheme(p.value, mode())
                    setMenuOpen(false)
                  }}
                >
                  <span class='flex-1'>{p.label}</span>
                  <Show when={active()}>
                    <Check class='h-4 w-4 shrink-0' stroke-width={2} />
                  </Show>
                </button>
              )
            }}
          </For>
        </div>
      </Show>
    </div>
  )
}
