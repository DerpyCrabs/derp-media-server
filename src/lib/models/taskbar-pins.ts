export interface TaskbarPinSource {
  kind: 'local'
  rootPath?: string | null
}

/** Serializable pinned taskbar target. */
export interface TaskbarPin {
  id: string
  path: string
  isDirectory: boolean
  title: string
  customIconName?: string | null
  isVirtual?: boolean
  source: TaskbarPinSource
}

function isValidSource(s: unknown): s is TaskbarPinSource {
  if (!s || typeof s !== 'object' || !('kind' in s)) return false
  const k = (s as TaskbarPinSource).kind
  if (k === 'local') return true
  return false
}

function isValidPin(p: unknown): p is TaskbarPin {
  return (
    !!p &&
    typeof p === 'object' &&
    typeof (p as TaskbarPin).id === 'string' &&
    typeof (p as TaskbarPin).path === 'string' &&
    typeof (p as TaskbarPin).isDirectory === 'boolean' &&
    typeof (p as TaskbarPin).title === 'string' &&
    isValidSource((p as TaskbarPin).source)
  )
}

export function parseTaskbarPins(raw: unknown): TaskbarPin[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isValidPin)
}
