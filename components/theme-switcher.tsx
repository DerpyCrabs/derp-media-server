import { useCallback, memo } from 'react'
import { Menu } from '@base-ui/react/menu'
import { AppWindow, Layers, Settings, Sun, Moon, Monitor, Check } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useTheme, type ThemePalette, type ThemeMode } from '@/lib/use-theme'
import {
  setWorkspaceFileOpenTarget,
  useWorkspaceFileOpenTargetStore,
  type WorkspaceFileOpenTarget,
} from '@/lib/workspace-file-open-target'
import { SnapLayoutTemplateThumbnail } from '@/components/workspace/snap-layout-template-thumbnail'
import { useWorkspaceSnapLayoutVisibility } from '@/lib/use-workspace-snap-layout-visibility'
import {
  SNAP_LAYOUT_ROW_1,
  SNAP_LAYOUT_ROW_2,
  SNAP_LAYOUT_ROW_VERTICAL,
  type SnapLayoutTemplate,
} from '@/lib/workspace-snap-layouts'
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

const FILE_OPEN_TARGETS: {
  value: WorkspaceFileOpenTarget
  label: string
  hint: string
  icon: typeof Layers
}[] = [
  {
    value: 'new-tab',
    label: 'New tab',
    hint: 'Open in the same window group as the file browser (tab strip).',
    icon: Layers,
  },
  {
    value: 'new-window',
    label: 'New window',
    hint: 'Open as a separate floating workspace window.',
    icon: AppWindow,
  },
]

const taskbarTriggerClass =
  'h-8 w-8 shrink-0 flex items-center justify-center rounded-none text-amber-500 hover:bg-amber-500/15 hover:text-amber-400 cursor-pointer outline-none'

/** Match default picker preview when the workspace area is landscape. */
const SNAP_SETTINGS_LANDSCAPE_AR = 16 / 12
/** Match tall picker previews for portrait-oriented workspace. */
const SNAP_SETTINGS_PORTRAIT_AR = 10 / 16

const SnapLayoutThumb = memo(function SnapLayoutThumb({
  template,
  on,
  onToggle,
  aspectRatio,
}: {
  template: SnapLayoutTemplate
  on: boolean
  onToggle: (id: string) => void
  aspectRatio: number
}) {
  const onClick = useCallback(() => {
    onToggle(template.id)
  }, [onToggle, template.id])
  return (
    <button
      type='button'
      onClick={onClick}
      aria-pressed={on}
      title={on ? 'Shown in snap picker — click to hide' : 'Hidden — click to show'}
      className={cn(
        'rounded-lg p-1 transition-[opacity,box-shadow]',
        on
          ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
          : 'opacity-45 hover:opacity-80',
      )}
    >
      <SnapLayoutTemplateThumbnail template={template} aspectRatio={aspectRatio} />
    </button>
  )
})

function SnapLayoutVisibilityRow({
  templates,
  visibleIds,
  onToggle,
  aspectRatio,
}: {
  templates: SnapLayoutTemplate[]
  visibleIds: Set<string>
  onToggle: (id: string) => void
  aspectRatio: number
}) {
  return (
    <div className='flex flex-wrap gap-2'>
      {templates.map((t) => (
        <SnapLayoutThumb
          key={t.id}
          template={t}
          on={visibleIds.has(t.id)}
          onToggle={onToggle}
          aspectRatio={aspectRatio}
        />
      ))}
    </div>
  )
}

const FileOpenTargetButton = memo(function FileOpenTargetButton({
  opt,
  selected,
}: {
  opt: (typeof FILE_OPEN_TARGETS)[number]
  selected: boolean
}) {
  const Icon = opt.icon
  const onClick = useCallback(() => {
    setWorkspaceFileOpenTarget(opt.value)
  }, [opt.value])
  return (
    <button
      type='button'
      title={opt.hint}
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-left transition-colors',
        selected
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border bg-muted/50 hover:bg-muted',
      )}
      onClick={onClick}
    >
      <Icon className='h-4 w-4 shrink-0' />
      <span className='flex-1'>{opt.label}</span>
      {selected && <Check className='h-4 w-4 shrink-0' />}
    </button>
  )
})

const SettingsModeButton = memo(function SettingsModeButton({
  m,
  palette,
  mode,
  setTheme,
}: {
  m: (typeof MODES)[number]
  palette: ThemePalette
  mode: ThemeMode
  setTheme: (p: ThemePalette, m: ThemeMode) => void
}) {
  const Icon = m.icon
  const onClick = useCallback(() => {
    setTheme(palette, m.value)
  }, [setTheme, palette, m.value])
  return (
    <button
      type='button'
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
        mode === m.value
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border bg-muted/50 hover:bg-muted',
      )}
      onClick={onClick}
    >
      <Icon className='h-4 w-4 shrink-0' />
      {m.label}
      {mode === m.value && <Check className='h-4 w-4 shrink-0' />}
    </button>
  )
})

const SettingsPaletteButton = memo(function SettingsPaletteButton({
  p,
  palette,
  mode,
  setTheme,
}: {
  p: (typeof PALETTES)[number]
  palette: ThemePalette
  mode: ThemeMode
  setTheme: (p: ThemePalette, m: ThemeMode) => void
}) {
  const onClick = useCallback(() => {
    setTheme(p.value, mode)
  }, [setTheme, p.value, mode])
  return (
    <button
      type='button'
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
        palette === p.value
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border bg-muted/50 hover:bg-muted',
      )}
      onClick={onClick}
    >
      {p.label}
      {palette === p.value && <Check className='h-4 w-4 shrink-0' />}
    </button>
  )
})

function SettingsModalContent() {
  const { palette, mode, setTheme } = useTheme()
  const fileOpenTarget = useWorkspaceFileOpenTargetStore((s) => s.target)
  const {
    visibleIds: visibleSnapLayoutIds,
    toggleLayout,
    showAllLayouts,
  } = useWorkspaceSnapLayoutVisibility()
  return (
    <>
      <DialogHeader>
        <DialogTitle>Settings</DialogTitle>
      </DialogHeader>
      <div className='grid gap-6'>
        <div>
          <div className='mb-2 text-xs font-medium text-muted-foreground'>
            Workspace · open files
          </div>
          <p className='mb-3 text-xs text-muted-foreground'>
            Default when you open a file from the workspace browser (saved on this device).
          </p>
          <div className='flex flex-col gap-2'>
            {FILE_OPEN_TARGETS.map((opt) => (
              <FileOpenTargetButton
                key={opt.value}
                opt={opt}
                selected={fileOpenTarget === opt.value}
              />
            ))}
          </div>
        </div>
        <div>
          <div className='mb-2 text-xs font-medium text-muted-foreground'>Mode</div>
          <div className='flex flex-wrap gap-2'>
            {MODES.map((m) => (
              <SettingsModeButton
                key={m.value}
                m={m}
                palette={palette}
                mode={mode}
                setTheme={setTheme}
              />
            ))}
          </div>
        </div>
        <div>
          <div className='mb-2 text-xs font-medium text-muted-foreground'>Theme</div>
          <div className='flex flex-wrap gap-2'>
            {PALETTES.map((p) => (
              <SettingsPaletteButton
                key={p.value}
                p={p}
                palette={palette}
                mode={mode}
                setTheme={setTheme}
              />
            ))}
          </div>
        </div>
        <div>
          <div className='mb-2 text-xs font-medium text-muted-foreground'>Snap layout picker</div>
          <p className='mb-3 text-xs text-muted-foreground'>
            Click a thumbnail to show or hide it in the picker (same previews as when snapping).
          </p>
          <div className='space-y-3 rounded-md border border-border bg-muted/20 p-3'>
            <SnapLayoutVisibilityRow
              templates={SNAP_LAYOUT_ROW_1}
              visibleIds={visibleSnapLayoutIds}
              onToggle={toggleLayout}
              aspectRatio={SNAP_SETTINGS_LANDSCAPE_AR}
            />
            <SnapLayoutVisibilityRow
              templates={SNAP_LAYOUT_ROW_2}
              visibleIds={visibleSnapLayoutIds}
              onToggle={toggleLayout}
              aspectRatio={SNAP_SETTINGS_LANDSCAPE_AR}
            />
            <div className='text-[10px] font-medium uppercase tracking-wider text-muted-foreground'>
              Portrait workspace
            </div>
            <SnapLayoutVisibilityRow
              templates={SNAP_LAYOUT_ROW_VERTICAL}
              visibleIds={visibleSnapLayoutIds}
              onToggle={toggleLayout}
              aspectRatio={SNAP_SETTINGS_PORTRAIT_AR}
            />
          </div>
          <button
            type='button'
            className='mt-3 text-sm text-muted-foreground hover:text-foreground underline'
            onClick={showAllLayouts}
          >
            Show all layouts
          </button>
        </div>
      </div>
    </>
  )
}

const MenuModeRow = memo(function MenuModeRow({
  m,
  palette,
  mode,
  setTheme,
}: {
  m: (typeof MODES)[number]
  palette: ThemePalette
  mode: ThemeMode
  setTheme: (p: ThemePalette, m: ThemeMode) => void
}) {
  const Icon = m.icon
  const onClick = useCallback(() => {
    setTheme(palette, m.value)
  }, [setTheme, palette, m.value])
  return (
    <Menu.Item
      className='flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground'
      onClick={onClick}
    >
      <Icon className='h-4 w-4 shrink-0' />
      <span className='flex-1'>{m.label}</span>
      {mode === m.value && <Check className='h-4 w-4 shrink-0' />}
    </Menu.Item>
  )
})

const MenuPaletteRow = memo(function MenuPaletteRow({
  p,
  palette,
  mode,
  setTheme,
}: {
  p: (typeof PALETTES)[number]
  palette: ThemePalette
  mode: ThemeMode
  setTheme: (p: ThemePalette, m: ThemeMode) => void
}) {
  const onClick = useCallback(() => {
    setTheme(p.value, mode)
  }, [setTheme, p.value, mode])
  return (
    <Menu.Item
      className='flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground'
      onClick={onClick}
    >
      <span className='flex-1'>{p.label}</span>
      {palette === p.value && <Check className='h-4 w-4 shrink-0' />}
    </Menu.Item>
  )
})

export function ThemeSwitcher({ variant = 'header' }: ThemeSwitcherProps) {
  const { palette, mode, setTheme } = useTheme()

  const triggerClass =
    variant === 'taskbar'
      ? taskbarTriggerClass
      : variant === 'floating'
        ? 'fixed top-4 right-4 z-50 rounded-md p-2 bg-background/80 backdrop-blur border border-border shadow-md hover:bg-accent'
        : buttonVariants({ variant: 'ghost', size: 'icon-sm' })

  if (variant === 'taskbar') {
    return (
      <Dialog>
        <DialogTrigger className={cn(triggerClass)} title='Settings' aria-label='Open settings'>
          <Settings className='h-4 w-4' />
        </DialogTrigger>
        <DialogContent className='sm:max-w-lg max-h-[85vh] overflow-y-auto'>
          <SettingsModalContent />
        </DialogContent>
      </Dialog>
    )
  }

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
          side={variant === 'floating' ? 'bottom' : 'top'}
          align='end'
          sideOffset={4}
        >
          <Menu.Popup className='data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 ring-foreground/10 bg-popover text-popover-foreground z-50 min-w-44 origin-(--transform-origin) overflow-hidden rounded-md p-1 shadow-md ring-1 duration-100 outline-none'>
            <div className='px-2 py-1.5 text-xs font-medium text-muted-foreground'>Mode</div>
            {MODES.map((m) => (
              <MenuModeRow key={m.value} m={m} palette={palette} mode={mode} setTheme={setTheme} />
            ))}
            <div className='my-1 h-px bg-border' />
            <div className='px-2 py-1.5 text-xs font-medium text-muted-foreground'>Theme</div>
            {PALETTES.map((p) => (
              <MenuPaletteRow
                key={p.value}
                p={p}
                palette={palette}
                mode={mode}
                setTheme={setTheme}
              />
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
