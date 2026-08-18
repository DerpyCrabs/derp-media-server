import { applyTheme, resolveTheme } from '@/lib/state/theme-dom'
import { useThemeStore, type ThemeMode, type ThemePalette } from '@/lib/state/theme-store'
import { fileOpenTargetStore, type FileOpenTarget } from '@/features/explorer/file-open-target'
import {
  MAX_TILED_WINDOW_GAP,
  useWorkspacePreferredSnapStore,
} from '@/workspace/model/workspace-preferred-snap-store'
import Check from 'lucide-solid/icons/check'
import Monitor from 'lucide-solid/icons/monitor'
import Moon from 'lucide-solid/icons/moon'
import Settings from 'lucide-solid/icons/settings'
import Sun from 'lucide-solid/icons/sun'
import type { Accessor } from 'solid-js'
import { For, Show, createEffect, createMemo, createSignal } from 'solid-js'
import { useStoreSync } from '@/lib/state/solid-store-sync'
import { cn } from '@/lib/ui/cn'

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
  value: FileOpenTarget
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
  onWorkspaceFileOpenTargetChange?: (value: FileOpenTarget) => void
  workspaceTransition?: () => 'instant' | 'fade'
  onWorkspaceTransitionChange?: (value: 'instant' | 'fade') => void
}

export function WorkspaceTaskbarSettings(props: WorkspaceTaskbarSettingsProps) {
  const [open, setOpen] = createSignal(false)
  const targetTick = useStoreSync(fileOpenTargetStore)
  const themeTick = useStoreSync(useThemeStore)
  const prefSnapTick = useStoreSync(useWorkspacePreferredSnapStore)

  const fileOpenTarget = () => {
    void targetTick()
    return fileOpenTargetStore.getState().target
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

  const tiledWindowGap = createMemo(() => {
    void prefSnapTick()
    return useWorkspacePreferredSnapStore.getState().tiledWindowGap
  })

  function setFileTarget(value: FileOpenTarget) {
    fileOpenTargetStore.getState().setTarget(value)
    props.onWorkspaceFileOpenTargetChange?.(value)
  }

  function setTheme(p: ThemePalette, m: ThemeMode) {
    useThemeStore.getState().setTheme(p, m)
    applyTheme(resolveTheme(p, m))
  }

  createEffect(
    () => open(),
    (isOpen) => {
      if (!isOpen) return undefined
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setOpen(false)
      }
      document.addEventListener('keydown', onKey)
      // eslint-disable-next-line solid/reactivity
      return () => document.removeEventListener('keydown', onKey)
    },
  )

  return (
    <div class='relative shrink-0'>
      <button
        type='button'
        class={triggerClass}
        title='Settings'
        aria-label='Open settings'
        aria-expanded={open() ? 'true' : 'false'}
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
              <div class='mb-2 text-xs font-medium text-muted-foreground'>Workspace transition</div>
              <div class='flex gap-2'>
                <For each={['instant', 'fade'] as const}>
                  {(transition) => (
                    <button
                      type='button'
                      class={cn(
                        'rounded-md border px-3 py-2 text-sm capitalize',
                        (props.workspaceTransition?.() ?? 'fade') === transition
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border hover:bg-muted',
                      )}
                      onClick={() => props.onWorkspaceTransitionChange?.(transition)}
                    >
                      {transition}
                    </button>
                  )}
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
                <span>Show snap assist when dragging to the top-center handle</span>
              </label>
              <label class='block text-sm font-medium' for='workspace-tile-gap'>
                Window gaps: {tiledWindowGap() === 0 ? 'Off' : `${tiledWindowGap()}px`}
              </label>
              <input
                id='workspace-tile-gap'
                type='range'
                min='0'
                max={MAX_TILED_WINDOW_GAP}
                step='1'
                value={tiledWindowGap()}
                class='mt-2 w-full'
                onInput={(e) =>
                  useWorkspacePreferredSnapStore
                    .getState()
                    .setTiledWindowGap(e.currentTarget.valueAsNumber)
                }
              />
              <p class='mt-1 text-xs text-muted-foreground'>
                Adds space between tiled windows and along viewport and panel edges.
              </p>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
