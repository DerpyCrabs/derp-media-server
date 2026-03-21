import { applyTheme, resolveTheme } from '@/lib/theme-dom'
import { useThemeStore, type ThemeMode, type ThemePalette } from '@/lib/theme-store'
import {
  useWorkspaceFileOpenTargetStore,
  type WorkspaceFileOpenTarget,
} from '@/lib/workspace-file-open-target'
import { useWorkspaceSnapLayoutVisibilityStore } from '@/lib/workspace-snap-layout-visibility-store'
import {
  SNAP_LAYOUT_ROW_1,
  SNAP_LAYOUT_ROW_2,
  SNAP_LAYOUT_ROW_VERTICAL,
} from '@/lib/workspace-snap-layouts'
import Check from 'lucide-solid/icons/check'
import Monitor from 'lucide-solid/icons/monitor'
import Moon from 'lucide-solid/icons/moon'
import Settings from 'lucide-solid/icons/settings'
import Sun from 'lucide-solid/icons/sun'
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import { useStoreSync } from '../lib/solid-store-sync'
import { cn } from '@/lib/utils'
import { SnapLayoutTemplateThumbnail } from './SnapLayoutTemplateThumbnail'

const SNAP_SETTINGS_LANDSCAPE_AR = 16 / 12
const SNAP_SETTINGS_PORTRAIT_AR = 10 / 16

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
    hint: 'Open in the same window group as the file browser (tab strip).',
  },
  {
    value: 'new-window',
    label: 'New window',
    hint: 'Open as a separate floating workspace window.',
  },
]

const triggerClass =
  'h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-none text-amber-500 hover:bg-amber-500/15 hover:text-amber-400 cursor-pointer outline-none border-0 bg-transparent'

export function WorkspaceTaskbarSettings() {
  const [open, setOpen] = createSignal(false)
  const targetTick = useStoreSync(useWorkspaceFileOpenTargetStore)
  const themeTick = useStoreSync(useThemeStore)
  const snapTick = useStoreSync(useWorkspaceSnapLayoutVisibilityStore)

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

  const visibleSnapIds = createMemo(() => {
    void snapTick()
    return new Set(useWorkspaceSnapLayoutVisibilityStore.getState().visibleIdList)
  })

  function setFileTarget(value: WorkspaceFileOpenTarget) {
    useWorkspaceFileOpenTargetStore.getState().setTarget(value)
  }

  function setTheme(p: ThemePalette, m: ThemeMode) {
    useThemeStore.getState().setTheme(p, m)
    applyTheme(resolveTheme(p, m))
  }

  function toggleSnapLayout(id: string) {
    useWorkspaceSnapLayoutVisibilityStore.getState().toggleLayout(id)
  }

  function showAllSnapLayouts() {
    useWorkspaceSnapLayoutVisibilityStore.getState().showAllLayouts()
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
              <div class='mb-2 text-xs font-medium text-muted-foreground'>
                Workspace · open files
              </div>
              <p class='mb-3 text-xs text-muted-foreground'>
                Default when you open a file from the workspace browser (saved on this device).
              </p>
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
              <div class='mb-2 text-xs font-medium text-muted-foreground'>Snap layout picker</div>
              <p class='mb-3 text-xs text-muted-foreground'>
                Click a thumbnail to show or hide it in the picker (same previews as when snapping).
              </p>
              <div class='space-y-3 rounded-md border border-border bg-muted/20 p-3'>
                <div class='flex flex-wrap gap-2'>
                  <For each={SNAP_LAYOUT_ROW_1}>
                    {(t) => {
                      const on = () => visibleSnapIds().has(t.id)
                      return (
                        <button
                          type='button'
                          aria-pressed={on()}
                          title={
                            on() ? 'Shown in snap picker — click to hide' : 'Hidden — click to show'
                          }
                          class={cn(
                            'rounded-lg p-1 transition-[opacity,box-shadow]',
                            on()
                              ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                              : 'opacity-45 hover:opacity-80',
                          )}
                          onClick={() => toggleSnapLayout(t.id)}
                        >
                          <SnapLayoutTemplateThumbnail
                            template={t}
                            aspectRatio={SNAP_SETTINGS_LANDSCAPE_AR}
                          />
                        </button>
                      )
                    }}
                  </For>
                </div>
                <div class='flex flex-wrap gap-2'>
                  <For each={SNAP_LAYOUT_ROW_2}>
                    {(t) => {
                      const on = () => visibleSnapIds().has(t.id)
                      return (
                        <button
                          type='button'
                          aria-pressed={on()}
                          title={
                            on() ? 'Shown in snap picker — click to hide' : 'Hidden — click to show'
                          }
                          class={cn(
                            'rounded-lg p-1 transition-[opacity,box-shadow]',
                            on()
                              ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                              : 'opacity-45 hover:opacity-80',
                          )}
                          onClick={() => toggleSnapLayout(t.id)}
                        >
                          <SnapLayoutTemplateThumbnail
                            template={t}
                            aspectRatio={SNAP_SETTINGS_LANDSCAPE_AR}
                          />
                        </button>
                      )
                    }}
                  </For>
                </div>
                <div class='text-[10px] font-medium uppercase tracking-wider text-muted-foreground'>
                  Portrait workspace
                </div>
                <div class='flex flex-wrap gap-2'>
                  <For each={SNAP_LAYOUT_ROW_VERTICAL}>
                    {(t) => {
                      const on = () => visibleSnapIds().has(t.id)
                      return (
                        <button
                          type='button'
                          aria-pressed={on()}
                          title={
                            on() ? 'Shown in snap picker — click to hide' : 'Hidden — click to show'
                          }
                          class={cn(
                            'rounded-lg p-1 transition-[opacity,box-shadow]',
                            on()
                              ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                              : 'opacity-45 hover:opacity-80',
                          )}
                          onClick={() => toggleSnapLayout(t.id)}
                        >
                          <SnapLayoutTemplateThumbnail
                            template={t}
                            aspectRatio={SNAP_SETTINGS_PORTRAIT_AR}
                          />
                        </button>
                      )
                    }}
                  </For>
                </div>
              </div>
              <button
                type='button'
                class='mt-3 text-left text-sm text-muted-foreground underline hover:text-foreground'
                onClick={() => showAllSnapLayouts()}
              >
                Show all layouts
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
