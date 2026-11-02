import { Button } from '@/lib/ui/button'
import { DropdownMenu } from '@/lib/ui/menu'
import Settings from '@effectweb/lucide/icons/settings'
import { observe, view } from 'effectweb'
import { themeStore, type ThemeMode, type ThemePalette } from '@/lib/state/theme-store'
import { applyTheme, resolveTheme } from '@/lib/state/theme-dom'
type Props = { variant?: 'header' | 'floating'; compact?: boolean }
const modes: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]
const palettes: { value: ThemePalette; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'caffeine', label: 'Caffeine' },
  { value: 'cosmic-night', label: 'Cosmic Night' },
]
const setTheme = (palette: ThemePalette, mode: ThemeMode) => {
  themeStore.setTheme(palette, mode)
  applyTheme(resolveTheme(palette, mode))
}
export const ThemeSwitcher = view<Props>((props) =>
  observe(themeStore.source, (theme) => (
    <div class={props.variant === 'floating' ? 'fixed bottom-4 right-4 z-10002' : undefined}>
      <DropdownMenu
        aria-label='Theme settings'
        align='end'
        side={props.variant === 'floating' ? 'top' : 'bottom'}
        trigger={
          <Button
            variant='ghost'
            size={props.compact ? 'icon-sm' : 'icon'}
            aria-label='Open theme settings'
          >
            <Settings />
          </Button>
        }
        items={[
          { kind: 'label', label: 'Mode' },
          ...modes.map(({ value, label }) => ({
            kind: 'radio' as const,
            label,
            value,
            checked: value === theme.mode,
            onSelect: () => setTheme(theme.palette, value),
          })),
          { kind: 'separator' },
          { kind: 'label', label: 'Theme' },
          ...palettes.map(({ value, label }) => ({
            kind: 'radio' as const,
            label,
            value,
            checked: value === theme.palette,
            onSelect: () => setTheme(value, theme.mode),
          })),
        ]}
      />
    </div>
  )),
)
