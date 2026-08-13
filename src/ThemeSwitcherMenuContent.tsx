import { useThemeStore, type ThemeMode, type ThemePalette } from '@/lib/theme-store'
import { applyTheme, resolveTheme } from '@/lib/theme-dom'
import Check from 'lucide-solid/icons/check'
import Monitor from 'lucide-solid/icons/monitor'
import Moon from 'lucide-solid/icons/moon'
import Sun from 'lucide-solid/icons/sun'
import { For, Show } from 'solid-js'
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

type Props = {
  onAfterPick?: () => void
  /** When false, do not call onAfterPick after a choice (menu stays open for more changes). */
  closeOnPick?: boolean
}

export function ThemeSwitcherMenuContent(props: Props) {
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

  function pick() {
    if (props.closeOnPick === false) return
    props.onAfterPick?.()
  }

  return (
    <>
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
                pick()
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
                pick()
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
    </>
  )
}
