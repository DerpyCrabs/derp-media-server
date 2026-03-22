export type ShareTextViewerSettings = {
  enabled: boolean
  readOnly: boolean
}

const STORAGE_KEY = 'share-text-viewer-settings'

type Persisted = { byKey: Record<string, ShareTextViewerSettings> }

function readFull(): Persisted {
  if (typeof localStorage === 'undefined') return { byKey: {} }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { byKey: {} }
    return JSON.parse(raw) as Persisted
  } catch {
    return { byKey: {} }
  }
}

function writeFull(p: Persisted) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch {
    /* noop */
  }
}

export function getShareTextViewerSettings(
  storageKey: string,
  defaults: ShareTextViewerSettings,
): ShareTextViewerSettings {
  if (!storageKey) return defaults
  const full = readFull()
  return full.byKey[storageKey] ?? defaults
}

export function setShareTextViewerSettings(storageKey: string, next: ShareTextViewerSettings) {
  if (!storageKey) return
  const full = readFull()
  writeFull({ byKey: { ...full.byKey, [storageKey]: next } })
}

export function migrateLegacyShareTextViewerKey(
  storageKey: string,
  defaults: ShareTextViewerSettings,
) {
  if (typeof localStorage === 'undefined' || !storageKey) return
  const full = readFull()
  if (full.byKey[storageKey]) return
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return
    const parsed = JSON.parse(raw) as { enabled?: boolean; readOnly?: boolean }
    setShareTextViewerSettings(storageKey, {
      enabled: parsed.enabled ?? defaults.enabled,
      readOnly: parsed.readOnly ?? defaults.readOnly,
    })
    localStorage.removeItem(storageKey)
  } catch {
    /* noop */
  }
}
