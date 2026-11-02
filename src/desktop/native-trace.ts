import type { DesktopBridge } from './bridge'

let sequence = 0
export type NativeOperation = {
  id: number
  kind: number
  path: number
  finished: boolean
  send: NonNullable<DesktopBridge['trace']>
}
function trace() {
  return typeof window === 'undefined' ? undefined : window.derpDesktop?.trace
}
export function beginNativeOperation(
  kind: number,
  path: string,
  send: DesktopBridge['trace'] | null = trace(),
): NativeOperation | undefined {
  if (!send) return undefined
  let hash = 2166136261
  for (let i = 0; i < path.length; i++) hash = Math.imul(hash ^ path.charCodeAt(i), 16777619)
  const operation = { id: ++sequence, kind, path: hash >>> 0, finished: false, send }
  send(11, operation.id, kind, operation.path)
  return operation
}
export function finishNativeOperation(operation: NativeOperation | undefined, phase = 10) {
  if (!operation || operation.finished) return
  operation.finished = true
  operation.send(phase, operation.id, operation.kind, operation.path)
}
