import { list, localComponent, view, observe, domBinding } from 'effectweb'
import { applyTheme, resolveTheme } from '@/lib/state/theme-dom'
import { themeStore, type ThemeMode, type ThemePalette } from '@/lib/state/theme-store'
import { fileOpenTargetStore, type FileOpenTarget } from '@/workspace/shared/file-open-target'
import {
  MAX_TILED_WINDOW_GAP,
  workspaceLayoutPreferences,
} from '@/workspace/model/workspace-preferred-snap-store'
import Check from '@effectweb/lucide/icons/check'
import Monitor from '@effectweb/lucide/icons/monitor'
import Moon from '@effectweb/lucide/icons/moon'
import Settings from '@effectweb/lucide/icons/settings'
import Sun from '@effectweb/lucide/icons/sun'
import { clientPreferencesStore } from '@/workspace/shared/client-preferences-store'
import { cn } from '@/lib/ui/cn'
import type { WorkspaceTransition } from '@/lib/models/settings-types'
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
const FILE_OPEN_TARGETS: { value: FileOpenTarget; label: string; hint: string }[] = [
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
  canReopenClosed?: boolean
  workspaceTransition: WorkspaceTransition
  onWorkspaceTransitionChange: (value: WorkspaceTransition) => void
}
const settingsEscape = (_element: HTMLElement, current: () => () => void) => {
  const listener = (event: KeyboardEvent) => {
    if (event.key === 'Escape') current()()
  }
  document.addEventListener('keydown', listener)
  return () => document.removeEventListener('keydown', listener)
}
function setTheme(p: ThemePalette, m: ThemeMode) {
  themeStore.setTheme(p, m)
  applyTheme(resolveTheme(p, m))
}
export const WorkspaceTaskbarSettings = localComponent<
  WorkspaceTaskbarSettingsProps,
  { open: boolean }
>({
  init: () => ({ open: false }),
  view: view((local, patch) =>
    observe(themeStore.source, (theme) =>
      observe(clientPreferencesStore.source, (preferences) => {
        const props = local.props
        const open = () => local.open
        const setOpen = (open: boolean) => patch({ open })
        const palette = () => theme.palette
        const mode = () => theme.mode
        const fileOpenTarget = () => preferences.fileOpenTarget
        const snapAssistOnTopDrag = () => preferences.snapAssistOnTopDrag
        const tiledWindowGap = () => preferences.tiledWindowGap
        const setFileTarget = (value: FileOpenTarget) => fileOpenTargetStore.setTarget(value)
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
            {open() ? (
              <>
                <div
                  class='fixed inset-0 z-[100000] bg-black/40'
                  role='presentation'
                  onClick={() => setOpen(false)}
                />
                <div
                  role='dialog'
                  use={domBinding(() => setOpen(false), settingsEscape)}
                  aria-modal='true'
                  aria-labelledby='workspace-settings-title'
                  class='ring-foreground/10 fixed left-1/2 top-1/2 z-[100001] max-h-[85vh] w-[min(100%-2rem,32rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-popover p-6 text-popover-foreground shadow-lg ring-1'
                  onClick={(e) => e.stopPropagation()}
                >
                  <h2 id='workspace-settings-title' class='text-lg font-semibold'>
                    Settings
                  </h2>
                  <div class='mt-6 grid gap-6'>
                    {props.reopenClosedTab ? (
                      <div>
                        <div class='mb-2 text-xs font-medium text-muted-foreground'>Tabs</div>
                        <button
                          type='button'
                          class='flex h-9 w-full items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-40'
                          disabled={!props.canReopenClosed}
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
                    ) : null}
                    <div>
                      <div class='mb-2 text-xs font-medium text-muted-foreground'>
                        Open files in
                      </div>
                      <div class='flex flex-col gap-2'>
                        {list(
                          FILE_OPEN_TARGETS,
                          (item) => item.value,
                          (opt) => {
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
                                {selected() ? (
                                  <Check
                                    class='h-4 w-4 shrink-0'
                                    stroke-width={2}
                                    aria-hidden='true'
                                  />
                                ) : null}
                              </button>
                            )
                          },
                        )}
                      </div>
                    </div>
                    <div>
                      <div class='mb-2 text-xs font-medium text-muted-foreground'>
                        Workspace transition
                      </div>
                      <div class='flex gap-2'>
                        {(['instant', 'fade'] as const).map((transition) => (
                          <button
                            type='button'
                            class={cn(
                              'rounded-md border px-3 py-2 text-sm capitalize',
                              props.workspaceTransition === transition
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border hover:bg-muted',
                            )}
                            onClick={() => props.onWorkspaceTransitionChange(transition)}
                          >
                            {transition}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div class='mb-2 text-xs font-medium text-muted-foreground'>Mode</div>
                      <div class='flex flex-wrap gap-2'>
                        {list(
                          MODES,
                          (item) => item.value,
                          (m) => {
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
                                {selected() ? (
                                  <Check class='h-4 w-4 shrink-0' stroke-width={2} />
                                ) : null}
                              </button>
                            )
                          },
                        )}
                      </div>
                    </div>
                    <div>
                      <div class='mb-2 text-xs font-medium text-muted-foreground'>Theme</div>
                      <div class='flex flex-wrap gap-2'>
                        {list(
                          PALETTES,
                          (item) => item.value,
                          (p) => {
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
                                {selected() ? (
                                  <Check class='h-4 w-4 shrink-0' stroke-width={2} />
                                ) : null}
                              </button>
                            )
                          },
                        )}
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
                            workspaceLayoutPreferences.setSnapAssistOnTopDrag(
                              e.currentTarget.checked,
                            )
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
                          workspaceLayoutPreferences.setTiledWindowGap(
                            e.currentTarget.valueAsNumber,
                          )
                        }
                      />
                      <p class='mt-1 text-xs text-muted-foreground'>
                        Adds space between tiled windows and along viewport and panel edges.
                      </p>
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        )
      }),
    ),
  ),
})
