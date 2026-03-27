import { applyTheme, resolveTheme } from '@/lib/theme-dom'
import { useThemeStore, type ThemeMode, type ThemePalette } from '@/lib/theme-store'
import {
  useWorkspaceFileOpenTargetStore,
  type WorkspaceFileOpenTarget,
} from '@/lib/workspace-file-open-target'
import { useWorkspacePreferredSnapStore } from '@/lib/workspace-preferred-snap-store'
import Check from 'lucide-solid/icons/check'
import Monitor from 'lucide-solid/icons/monitor'
import Moon from 'lucide-solid/icons/moon'
import Settings from 'lucide-solid/icons/settings'
import Sun from 'lucide-solid/icons/sun'
import type { Accessor } from 'solid-js'
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import { WORKSPACE_TAB_ICON_SWATCHES } from '@/lib/workspace-tab-icon-colors'
import { SOLID_AVAILABLE_ICONS } from '../lib/solid-available-icons'
import { useStoreSync } from '../lib/solid-store-sync'
import { cn } from '@/lib/utils'

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
}[] = [
  {
    value: 'new-tab',
    label: 'New tab',
    hint: 'Open in the active tab’s window group (next to the focused tab when possible).',
  },
  {
    value: 'new-window',
    label: 'New window',
    hint: 'Open as a separate floating workspace window.',
  },
]

const triggerClass =
  'h-8 w-8 shrink-0 inline-flex cursor-pointer items-center justify-center rounded-none border-0 bg-transparent text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'

export type WorkspaceTaskbarSettingsProps = {
  reopenClosedTab?: () => void
  canReopenClosed?: Accessor<boolean>
  browserTabTitle: Accessor<string>
  browserTabIcon: Accessor<string>
  browserTabIconColor: Accessor<string>
  onBrowserTabTitleChange: (value: string) => void
  onBrowserTabIconChange: (value: string) => void
  onBrowserTabIconColorChange: (value: string) => void
}

export function WorkspaceTaskbarSettings(props: WorkspaceTaskbarSettingsProps) {
  const [open, setOpen] = createSignal(false)
  const targetTick = useStoreSync(useWorkspaceFileOpenTargetStore)
  const themeTick = useStoreSync(useThemeStore)
  const prefSnapTick = useStoreSync(useWorkspacePreferredSnapStore)

  const fileOpenTarget = () => {
    void targetTick()
    return useWorkspaceFileOpenTargetStore.getState().target
  }

  const palette = () => {
    void themeTick()
    return useThemeStore.getState().palette
  }

  const mode = () => {
    void themeTick()
    return useThemeStore.getState().mode
  }

  const snapAssistOnTopDrag = createMemo(() => {
    void prefSnapTick()
    return useWorkspacePreferredSnapStore.getState().snapAssistOnTopDrag
  })

  function setFileTarget(value: WorkspaceFileOpenTarget) {
    useWorkspaceFileOpenTargetStore.getState().setTarget(value)
  }

  function setTheme(p: ThemePalette, m: ThemeMode) {
    useThemeStore.getState().setTheme(p, m)
    applyTheme(resolveTheme(p, m))
  }

  createEffect(() => {
    if (!open()) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    onCleanup(() => document.removeEventListener('keydown', onKey))
  })

  return (
    <div class='relative shrink-0'>
      <button
        type='button'
        class={triggerClass}
        title='Settings'
        aria-label='Open settings'
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        <Settings class='h-4 w-4' stroke-width={2} aria-hidden='true' />
      </button>
      <Show when={open()}>
        <div
          class='fixed inset-0 z-[100000] bg-black/40'
          role='presentation'
          onClick={() => setOpen(false)}
        />
        <div
          role='dialog'
          aria-modal='true'
          aria-labelledby='workspace-settings-title'
          class='ring-foreground/10 fixed left-1/2 top-1/2 z-[100001] max-h-[85vh] w-[min(100%-2rem,32rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-popover p-6 text-popover-foreground shadow-lg ring-1'
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id='workspace-settings-title' class='text-lg font-semibold'>
            Settings
          </h2>
          <div class='mt-6 grid gap-6'>
            <div>
              <div class='mb-2 text-xs font-medium text-muted-foreground'>Browser tab</div>
              <label class='mb-2 block text-sm font-medium'>Title</label>
              <input
                type='text'
                class='mb-3 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm'
                placeholder='Workspace'
                maxLength={120}
                value={props.browserTabTitle()}
                onInput={(e) => props.onBrowserTabTitleChange(e.currentTarget.value)}
              />
              <label class='mb-2 block text-sm font-medium'>Icon</label>
              <div class='grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6'>
                <For each={SOLID_AVAILABLE_ICONS}>
                  {(icon) => {
                    const Icon = icon.Icon
                    const selected = () => props.browserTabIcon() === icon.name
                    return (
                      <button
                        type='button'
                        title={icon.name}
                        class={cn(
                          'flex items-center justify-center rounded-lg border-2 p-3 transition-all hover:bg-muted/50',
                          selected()
                            ? 'border-primary bg-primary/10'
                            : 'border-border hover:border-primary/50',
                        )}
                        onClick={() => props.onBrowserTabIconChange(icon.name)}
                      >
                        <Icon class='h-6 w-6' size={24} stroke-width={2} />
                      </button>
                    )
                  }}
                </For>
              </div>
              <label class='mb-2 mt-3 block text-sm font-medium'>Icon color</label>
              <div class='flex flex-wrap gap-2'>
                <button
                  type='button'
                  disabled={!props.browserTabIcon()}
                  class={cn(
                    'h-8 min-w-8 shrink-0 rounded-md border-2 px-2 text-xs font-medium disabled:opacity-40',
                    !props.browserTabIconColor()
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-muted/60 hover:bg-muted',
                  )}
                  onClick={() => props.onBrowserTabIconColorChange('')}
                >
                  Auto
                </button>
                <For each={WORKSPACE_TAB_ICON_SWATCHES}>
                  {(s) => (
                    <button
                      type='button'
                      disabled={!props.browserTabIcon()}
                      title={s.key}
                      class={cn(
                        'h-8 w-8 shrink-0 rounded-md border-2 disabled:opacity-40',
                        s.twBg,
                        props.browserTabIconColor() === s.key
                          ? 'border-primary'
                          : 'border-black/25 dark:border-white/30',
                      )}
                      onClick={() => props.onBrowserTabIconColorChange(s.key)}
                    />
                  )}
                </For>
              </div>
              <button
                type='button'
                class='mt-3 text-xs font-medium text-muted-foreground underline decoration-muted-foreground/50 underline-offset-2 hover:text-foreground'
                onClick={() => {
                  props.onBrowserTabTitleChange('')
                  props.onBrowserTabIconChange('')
                  props.onBrowserTabIconColorChange('')
                }}
              >
                Reset tab appearance
              </button>
            </div>
            <Show when={props.reopenClosedTab}>
              <div>
                <div class='mb-2 text-xs font-medium text-muted-foreground'>Tabs</div>
                <button
                  type='button'
                  class='flex h-9 w-full items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-40'
                  disabled={!props.canReopenClosed?.()}
                  onClick={() => {
                    props.reopenClosedTab?.()
                    setOpen(false)
                  }}
                >
                  Reopen closed tab
                </button>
                <p class='mt-2 text-xs text-muted-foreground'>
                  Shortcut: Ctrl+Shift+T (⌘+Shift+T on Mac)
                </p>
              </div>
            </Show>
            <div>
              <div class='mb-2 text-xs font-medium text-muted-foreground'>Open files in</div>
              <div class='flex flex-col gap-2'>
                <For each={FILE_OPEN_TARGETS}>
                  {(opt) => {
                    const selected = () => fileOpenTarget() === opt.value
                    return (
                      <button
                        type='button'
                        title={opt.hint}
                        class={cn(
                          'flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                          selected()
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-muted/50 hover:bg-muted',
                        )}
                        onClick={() => {
                          setFileTarget(opt.value)
                          setOpen(false)
                        }}
                      >
                        <span class='flex-1'>{opt.label}</span>
                        <Show when={selected()}>
                          <Check class='h-4 w-4 shrink-0' stroke-width={2} aria-hidden='true' />
                        </Show>
                      </button>
                    )
                  }}
                </For>
              </div>
            </div>
            <div>
              <div class='mb-2 text-xs font-medium text-muted-foreground'>Mode</div>
              <div class='flex flex-wrap gap-2'>
                <For each={MODES}>
                  {(m) => {
                    const Icon = m.icon
                    const selected = () => mode() === m.value
                    return (
                      <button
                        type='button'
                        class={cn(
                          'flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
                          selected()
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-muted/50 hover:bg-muted',
                        )}
                        onClick={() => setTheme(palette(), m.value)}
                      >
                        <Icon class='h-4 w-4 shrink-0' stroke-width={2} />
                        {m.label}
                        <Show when={selected()}>
                          <Check class='h-4 w-4 shrink-0' stroke-width={2} />
                        </Show>
                      </button>
                    )
                  }}
                </For>
              </div>
            </div>
            <div>
              <div class='mb-2 text-xs font-medium text-muted-foreground'>Theme</div>
              <div class='flex flex-wrap gap-2'>
                <For each={PALETTES}>
                  {(p) => {
                    const selected = () => palette() === p.value
                    return (
                      <button
                        type='button'
                        class={cn(
                          'flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
                          selected()
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-muted/50 hover:bg-muted',
                        )}
                        onClick={() => setTheme(p.value, mode())}
                      >
                        {p.label}
                        <Show when={selected()}>
                          <Check class='h-4 w-4 shrink-0' stroke-width={2} />
                        </Show>
                      </button>
                    )
                  }}
                </For>
              </div>
            </div>
            <div>
              <div class='mb-2 text-xs font-medium text-muted-foreground'>Tiling</div>
              <label class='mb-3 flex cursor-pointer items-start gap-2 text-sm'>
                <input
                  type='checkbox'
                  class='mt-0.5'
                  checked={snapAssistOnTopDrag()}
                  onInput={(e) =>
                    useWorkspacePreferredSnapStore
                      .getState()
                      .setSnapAssistOnTopDrag(e.currentTarget.checked)
                  }
                />
                <span>Show snap assist when dragging to the top-center strip (~300px wide)</span>
              </label>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
