declare global {
  // eslint-disable-next-line no-var
  var __fileClients: Set<ReadableStreamDefaultController> | undefined
}

const clients: Set<ReadableStreamDefaultController> =
  global.__fileClients ?? (global.__fileClients = new Set())

export function addFileClient(controller: ReadableStreamDefaultController) {
  clients.add(controller)
}

export function removeFileClient(controller: ReadableStreamDefaultController) {
  clients.delete(controller)
}

export function broadcastFileChange(directory: string) {
  if (clients.size === 0) return
  const message = `data: ${JSON.stringify({ type: 'files-changed', directory })}\n\n`
  const encoded = new TextEncoder().encode(message)
  clients.forEach((controller) => {
    try {
      controller.enqueue(encoded)
    } catch {
      clients.delete(controller)
    }
  })
}
