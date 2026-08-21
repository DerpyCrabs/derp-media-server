import type { BookDocument, BookWorkerRequest, BookWorkerResponse } from './book-types'

export function parseBook(bytes: ArrayBuffer, fileName: string): Promise<BookDocument> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./book-worker.ts', import.meta.url), { type: 'module' })
    const timeout = window.setTimeout(() => {
      worker.terminate()
      reject(new Error('Book parsing timed out after 30 seconds'))
    }, 30_000)
    worker.onmessage = (event: MessageEvent<BookWorkerResponse>) => {
      window.clearTimeout(timeout)
      worker.terminate()
      if (event.data.ok) resolve(event.data.document)
      else reject(new Error(event.data.error))
    }
    worker.onerror = (event) => {
      window.clearTimeout(timeout)
      worker.terminate()
      reject(new Error(event.message || 'Book parser worker failed'))
    }
    const request: BookWorkerRequest = { bytes, fileName }
    worker.postMessage(request, [bytes])
  })
}
