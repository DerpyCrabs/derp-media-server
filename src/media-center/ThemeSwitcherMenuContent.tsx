import { themeStore, type ThemeMode, type ThemePalette } from '@/lib/state/theme-store'
import { applyTheme, resolveTheme } from '@/lib/state/theme-dom'
import Check from '@effectweb/lucide/icons/check'
import Monitor from '@effectweb/lucide/icons/monitor'
import Moon from '@effectweb/lucide/icons/moon'
import Sun from '@effectweb/lucide/icons/sun'
import { observe, view, list } from 'effectweb'
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
export const ThemeSwitcherMenuContent = view<Props>((props) =>
  observe(themeStore.source, (theme) => {
    const palette = () => theme.palette
    const mode = () => theme.mode
    function setTheme(p: ThemePalette, m: ThemeMode) {
      themeStore.setTheme(p, m)
      applyTheme(resolveTheme(p, m))
    }
    function pick() {
      if (props.closeOnPick === false) return
      props.onAfterPick?.()
    }
    return (
      <>
        <div class='text-muted-foreground px-2 py-1.5 text-xs font-medium'>Mode</div>
        {list(
          MODES,
          (item) => item.value,
          (m) => {
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
                {active() ? <Check class='h-4 w-4 shrink-0' stroke-width={2} /> : null}
              </button>
            )
          },
        )}
        <div class='bg-border my-1 h-px' />
        <div class='text-muted-foreground px-2 py-1.5 text-xs font-medium'>Theme</div>
        {list(
          PALETTES,
          (item) => item.value,
          (p) => {
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
                {active() ? <Check class='h-4 w-4 shrink-0' stroke-width={2} /> : null}
              </button>
            )
          },
        )}
      </>
    )
  }),
)
