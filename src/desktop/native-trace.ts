import type {} from './bridge'

let sequence = 0
export type NativeOperation = { id: number; kind: number; path: number; finished: boolean }
function trace() {
  return typeof window === 'undefined' ? undefined : window.derpDesktop?.trace
}
export function beginNativeOperation(kind: number, path: string): NativeOperation | undefined {
  const send = trace()
  if (!send) return undefined
  let hash = 2166136261
  for (let i = 0; i < path.length; i++) hash = Math.imul(hash ^ path.charCodeAt(i), 16777619)
  const operation = { id: ++sequence, kind, path: hash >>> 0, finished: false }
  send(11, operation.id, kind, operation.path)
  return operation
}
export function finishNativeOperation(operation: NativeOperation | undefined, phase = 10) {
  if (!operation || operation.finished) return
  operation.finished = true
  trace()?.(phase, operation.id, operation.kind, operation.path)
}
