import { TaskbarButton } from '../shared/TaskbarButton'
import { Checkbox } from '@/lib/ui/checkbox'
import { Dialog } from '@/lib/ui/dialog'
import { Select } from '@/lib/ui/select'
import { Slider } from '@/lib/ui/slider'
import { SettingRow } from '@/lib/ui/field'
import { component, view, observe } from 'effectweb'
import { applyTheme, resolveTheme } from '@/lib/state/theme-dom'
import { themeStore, type ThemeMode, type ThemePalette } from '@/lib/state/theme-store'
import { fileOpenTargetStore, type FileOpenTarget } from '@/workspace/shared/file-open-target'
import {
  MAX_TILED_WINDOW_GAP,
  workspaceLayoutPreferences,
} from '@/workspace/model/workspace-preferred-snap-store'
import Settings from '@effectweb/lucide/icons/settings'
import { clientPreferencesStore } from '@/workspace/shared/client-preferences-store'
import type { WorkspaceTransition } from '@/lib/models/settings-types'
export type WorkspaceTaskbarSettingsProps = {
  workspaceTransition: WorkspaceTransition
  onWorkspaceTransitionChange: (value: WorkspaceTransition) => void
}
function setTheme(palette: ThemePalette, mode: ThemeMode) {
  themeStore.setTheme(palette, mode)
  applyTheme(resolveTheme(palette, mode))
}
export const WorkspaceTaskbarSettings = component<WorkspaceTaskbarSettingsProps, { open: boolean }>(
  { init: () => ({ open: false }) },
  view((local, patch) =>
    observe(themeStore.source, (theme) =>
      observe(clientPreferencesStore.source, (preferences) => (
        <>
          <TaskbarButton
            variant='ghost'
            size='icon'
            class='h-8 w-8 text-muted-foreground hover:text-foreground'
            title='Settings'
            aria-label='Open settings'
            aria-expanded={local.open}
            onClick={() => patch({ open: true })}
          >
            <Settings />
          </TaskbarButton>
          <Dialog
            open={local.open}
            onOpenChange={(open) => patch({ open })}
            title='Settings'
            class='sm:max-w-lg max-h-[85dvh] overflow-y-auto'
          >
            <section>
              <h3 class='mb-1 text-xs font-medium text-muted-foreground'>Appearance</h3>
              <SettingRow label='Mode'>
                <Select
                  aria-label='Theme mode'
                  value={theme.mode}
                  options={[
                    { value: 'light', label: 'Light' },
                    { value: 'dark', label: 'Dark' },
                    { value: 'system', label: 'System' },
                  ]}
                  onValueChange={(value) => setTheme(theme.palette, value as ThemeMode)}
                  class='w-full'
                />
              </SettingRow>
              <SettingRow label='Theme'>
                <Select
                  aria-label='Theme'
                  value={theme.palette}
                  options={[
                    { value: 'default', label: 'Default' },
                    { value: 'caffeine', label: 'Caffeine' },
                    { value: 'cosmic-night', label: 'Cosmic Night' },
                  ]}
                  onValueChange={(value) => setTheme(value as ThemePalette, theme.mode)}
                  class='w-full'
                />
              </SettingRow>
            </section>
            <section class='border-t border-border pt-4'>
              <h3 class='mb-1 text-xs font-medium text-muted-foreground'>Workspace</h3>
              <SettingRow label='Open files in'>
                <Select
                  aria-label='Open files in'
                  value={preferences.fileOpenTarget}
                  options={[
                    { value: 'new-tab', label: 'New tab' },
                    { value: 'new-window', label: 'New window' },
                  ]}
                  onValueChange={(value) => fileOpenTargetStore.setTarget(value as FileOpenTarget)}
                  class='w-full'
                />
              </SettingRow>
              <SettingRow label='Transition'>
                <Select
                  aria-label='Workspace transition'
                  value={local.props.workspaceTransition}
                  options={[
                    { value: 'instant', label: 'Instant' },
                    { value: 'fade', label: 'Fade' },
                  ]}
                  onValueChange={(value) =>
                    local.props.onWorkspaceTransitionChange(value as WorkspaceTransition)
                  }
                  class='w-full'
                />
              </SettingRow>
              <label class='flex items-center justify-between gap-4 py-3 text-sm'>
                Snap assist
                <Checkbox
                  checked={preferences.snapAssistOnTopDrag}
                  onCheckedChange={workspaceLayoutPreferences.setSnapAssistOnTopDrag}
                />
              </label>
              <SettingRow
                label={`Window gaps · ${preferences.tiledWindowGap === 0 ? 'Off' : `${preferences.tiledWindowGap}px`}`}
              >
                <Slider
                  aria-label='Window gaps'
                  min={0}
                  max={MAX_TILED_WINDOW_GAP}
                  step={1}
                  value={preferences.tiledWindowGap}
                  onValueChange={workspaceLayoutPreferences.setTiledWindowGap}
                />
              </SettingRow>
            </section>
          </Dialog>
        </>
      )),
    ),
  ),
)
