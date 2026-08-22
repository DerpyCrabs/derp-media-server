type HermesSessionOpenTarget = {
  provider: 'hermes'
  type: 'hermesSession'
  sessionId: string
  projectPath?: never
  readOnly: boolean
  [key: string]: unknown
}

type HermesDraftOpenTarget = {
  provider: 'hermes'
  type: 'hermesDraft'
  sessionId?: never
  projectPath?: string | null
  readOnly: boolean
  [key: string]: unknown
}

export type HermesOpenTarget = HermesSessionOpenTarget | HermesDraftOpenTarget

export function isHermesOpenTarget(target: unknown): target is HermesOpenTarget {
  if (!target || typeof target !== 'object') return false
  const value = target as Record<string, unknown>
  if (value.provider !== 'hermes' || typeof value.readOnly !== 'boolean') return false
  if (value.type === 'hermesSession') {
    return (
      typeof value.sessionId === 'string' &&
      value.sessionId.trim().length > 0 &&
      value.projectPath === undefined
    )
  }
  if (value.type !== 'hermesDraft') return false
  return (
    value.sessionId === undefined &&
    (value.projectPath === undefined ||
      value.projectPath === null ||
      typeof value.projectPath === 'string')
  )
}
