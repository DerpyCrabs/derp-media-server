export type FileChangeCallback = (data: string) => void

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

export function broadcastFileChange(directory: string) {
  if (clients.size === 0) return
  const message = `data: ${JSON.stringify({ type: 'files-changed', directory })}\n\n`
  clients.forEach((cb) => {
    try {
      cb(message)
    } catch {
      clients.delete(cb)
    }
  })
}
