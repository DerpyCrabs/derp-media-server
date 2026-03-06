export interface FileChangeEvent {
  directory: string
  path?: string
}

export type FileChangeCallback = (event: FileChangeEvent) => void

declare global {
  // eslint-disable-next-line no-var
  var __fileClients: Set<FileChangeCallback> | undefined
}

const clients: Set<FileChangeCallback> = global.__fileClients ?? (global.__fileClients = new Set())

export function addFileClient(callback: FileChangeCallback) {
  clients.add(callback)
}

export function removeFileClient(callback: FileChangeCallback) {
  clients.delete(callback)
}

function normalizeBroadcastPath(value: string): string {
  const normalized = value.replace(/\\/g, '/')
  return normalized === '.' ? '' : normalized
}

export function broadcastFileChange(directory: string, changedPath?: string) {
  if (clients.size === 0) return
  const event: FileChangeEvent = {
    directory: normalizeBroadcastPath(directory),
    ...(changedPath !== undefined ? { path: normalizeBroadcastPath(changedPath) } : {}),
  }
  clients.forEach((cb) => {
    try {
      cb(event)
    } catch {
      clients.delete(cb)
    }
  })
}
