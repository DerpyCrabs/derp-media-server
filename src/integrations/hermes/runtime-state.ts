export const deletedHermesSessionIds = new Set<string>()

export type HermesSessionLiveStatus = Readonly<{
  needsInput: boolean
  working: boolean
  failed: boolean
  unread: boolean
}>

let sessionLiveStatus: (sessionId: string) => HermesSessionLiveStatus | null = () => null

export function registerHermesSessionLiveStatus(
  resolver: (sessionId: string) => HermesSessionLiveStatus | null,
): void {
  sessionLiveStatus = resolver
}

export function hermesSessionLiveStatus(sessionId: string): HermesSessionLiveStatus | null {
  return sessionLiveStatus(sessionId)
}
