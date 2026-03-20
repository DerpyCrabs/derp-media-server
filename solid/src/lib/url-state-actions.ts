import { navigateSearchParams } from '../browser-history'

type UrlParamKey = 'dir' | 'viewing' | 'playing' | 'audioOnly'

type ParamUpdates = Partial<Record<UrlParamKey, string | null>>

function applyUpdates(updates: ParamUpdates, mode: 'push' | 'replace') {
  navigateSearchParams(
    Object.fromEntries(
      Object.entries(updates).map(([k, v]) => [k, v === undefined ? null : v]),
    ) as Record<string, string | null>,
    mode,
  )
}

export function navigateToFolder(path: string | null) {
  applyUpdates({ dir: path === '' || path == null ? null : path }, 'push')
}

export function viewFile(path: string, dir?: string) {
  const updates: ParamUpdates = { viewing: path }
  if (dir !== undefined) updates.dir = dir
  applyUpdates(updates, 'replace')
}

export function playFile(path: string, dir?: string) {
  const updates: ParamUpdates = { playing: path, viewing: null }
  if (dir !== undefined) updates.dir = dir
  applyUpdates(updates, 'replace')
}

export function closeViewer() {
  applyUpdates({ viewing: null }, 'replace')
}

export function closePlayer() {
  applyUpdates({ playing: null, audioOnly: null }, 'replace')
}

export function setAudioOnly(enabled: boolean) {
  applyUpdates({ audioOnly: enabled ? 'true' : null }, 'replace')
}
