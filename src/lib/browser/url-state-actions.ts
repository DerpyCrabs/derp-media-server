import { navigateSearchParams } from './browser-history'
import { movePath, pathIsWithin, type PathMutation } from '@/lib/files/path-mutation'

type UrlParamKey = 'dir' | 'viewing' | 'playing' | 'audioOnly' | 'imageSeed'

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

export function viewFile(path: string, dir?: string, imageSeed: string | null = null) {
  const updates: ParamUpdates = { viewing: path, imageSeed }
  if (dir !== undefined) updates.dir = dir
  applyUpdates(updates, 'replace')
}

export function playFile(path: string, dir?: string) {
  const updates: ParamUpdates = { playing: path, viewing: null, imageSeed: null }
  if (dir !== undefined) updates.dir = dir
  applyUpdates(updates, 'replace')
}

export function closeViewer() {
  applyUpdates({ viewing: null, imageSeed: null }, 'replace')
}

export function closePlayer() {
  applyUpdates({ playing: null, audioOnly: null }, 'replace')
}

export function setAudioOnly(enabled: boolean) {
  applyUpdates({ audioOnly: enabled ? 'true' : null }, 'replace')
}

export function applyPathMutationToUrl(mutation: PathMutation) {
  const params = new URLSearchParams(window.location.search)
  const updates: ParamUpdates = {}
  for (const key of ['dir', 'viewing', 'playing'] as const) {
    const path = params.get(key)
    if (!path) continue
    const affectedPath = mutation.type === 'path-moved' ? mutation.oldPath : mutation.path
    if (!pathIsWithin(path, affectedPath)) continue
    updates[key] =
      mutation.type === 'path-moved' ? movePath(path, mutation.oldPath, mutation.newPath) : null
  }
  if (updates.viewing === null) updates.imageSeed = null
  if (updates.playing === null) updates.audioOnly = null
  if (Object.keys(updates).length > 0) applyUpdates(updates, 'replace')
}
