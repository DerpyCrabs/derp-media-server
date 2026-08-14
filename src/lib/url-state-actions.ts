import { navigateSearchParams } from '../browser-history'
import type { RouteQueryUpdates } from './routes'

type UrlParamKey = 'viewing' | 'playing' | 'audioOnly'

type ParamUpdates = Partial<Record<UrlParamKey, string | null>>

function applyUpdates(updates: ParamUpdates, mode: 'push' | 'replace') {
  navigateSearchParams(
    Object.fromEntries(
      Object.entries(updates).map(([k, v]) => [k, v === undefined ? null : v]),
    ) as RouteQueryUpdates,
    mode,
  )
}

export function viewFile(path: string) {
  applyUpdates({ viewing: path }, 'replace')
}

export function playFile(path: string) {
  applyUpdates({ playing: path, viewing: null }, 'replace')
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
