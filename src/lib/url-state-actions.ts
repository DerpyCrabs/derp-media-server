import { navigateSearchParams } from '../browser-history'
import type { ViewerId } from '@/lib/resource'

type UrlParamKey = 'dir' | 'viewing' | 'playing' | 'audioOnly' | 'viewer'

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
  applyUpdates({ dir: path }, 'push')
}

export function viewFile(path: string, dir?: string, viewerId?: ViewerId) {
  const updates: ParamUpdates = { viewing: path, viewer: viewerId ?? null }
  if (dir !== undefined) updates.dir = dir
  applyUpdates(updates, 'replace')
}

export function playFile(path: string, dir?: string) {
  const updates: ParamUpdates = { playing: path, viewing: null, viewer: null }
  if (dir !== undefined) updates.dir = dir
  applyUpdates(updates, 'replace')
}

export function closeViewer() {
  applyUpdates({ viewing: null, viewer: null }, 'replace')
}

export function closePlayer() {
  applyUpdates({ playing: null, audioOnly: null }, 'replace')
}

export function setAudioOnly(enabled: boolean) {
  applyUpdates({ audioOnly: enabled ? 'true' : null }, 'replace')
}
