import { Menu } from '@base-ui/react/menu'
import { Settings, Sun, Moon, Monitor, Check } from 'lucide-react'
import { useTheme, type ThemePalette, type ThemeMode } from '@/lib/use-theme'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ThemeSwitcherProps {
  variant?: 'header' | 'taskbar' | 'floating'
}

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

export function ThemeSwitcher({ variant = 'header' }: ThemeSwitcherProps) {
  const { palette, mode, setTheme } = useTheme()

  const triggerClass =
    variant === 'taskbar'
      ? 'h-8 w-8 shrink-0 flex items-center justify-center rounded-none text-amber-500 hover:bg-amber-500/15 hover:text-amber-400'
      : variant === 'floating'
        ? 'fixed top-4 right-4 z-50 rounded-md p-2 bg-background/80 backdrop-blur border border-border shadow-md hover:bg-accent'
        : buttonVariants({ variant: 'ghost', size: 'icon-sm' })

  return (
    <Menu.Root>
      <Menu.Trigger
        className={cn(triggerClass, 'cursor-pointer outline-none')}
        title='Theme settings'
        aria-label='Open theme settings'
      >
        <Settings className='h-4 w-4' />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          className='isolate z-10001 outline-none'
          side={variant === 'taskbar' ? 'top' : variant === 'floating' ? 'bottom' : 'top'}
          align='end'
          sideOffset={variant === 'taskbar' ? 8 : 4}
        >
          <Menu.Popup className='data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 ring-foreground/10 bg-popover text-popover-foreground z-50 min-w-44 origin-(--transform-origin) overflow-hidden rounded-md p-1 shadow-md ring-1 duration-100 outline-none'>
            <div className='px-2 py-1.5 text-xs font-medium text-muted-foreground'>Mode</div>
            {MODES.map((m) => {
              const Icon = m.icon
              return (
                <Menu.Item
                  key={m.value}
                  className='flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground'
                  onClick={() => setTheme(palette, m.value)}
                >
                  <Icon className='h-4 w-4 shrink-0' />
                  <span className='flex-1'>{m.label}</span>
                  {mode === m.value && <Check className='h-4 w-4 shrink-0' />}
                </Menu.Item>
              )
            })}
            <div className='my-1 h-px bg-border' />
            <div className='px-2 py-1.5 text-xs font-medium text-muted-foreground'>Theme</div>
            {PALETTES.map((p) => (
              <Menu.Item
                key={p.value}
                className='flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground'
                onClick={() => setTheme(p.value, mode)}
              >
                <span className='flex-1'>{p.label}</span>
                {palette === p.value && <Check className='h-4 w-4 shrink-0' />}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
