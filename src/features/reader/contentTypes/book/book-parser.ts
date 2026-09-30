import { Effect } from 'effect'
import type { BookDocument, BookWorkerRequest, BookWorkerResponse } from './book-types'

export function parseBook(bytes: ArrayBuffer, fileName: string) {
  return Effect.callback<BookDocument, Error>((resume) => {
    const worker = new Worker(new URL('./book-worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<BookWorkerResponse>) => {
      resume(
        event.data.ok
          ? Effect.succeed(event.data.document)
          : Effect.fail(new Error(event.data.error)),
      )
    }
    worker.onerror = (event) =>
      resume(Effect.fail(new Error(event.message || 'Book parser worker failed')))
    const request: BookWorkerRequest = { bytes, fileName }
    worker.postMessage(request, [bytes])
    return Effect.sync(() => {
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
    })
  }).pipe(
    Effect.timeoutOrElse({
      duration: '30 seconds',
      orElse: () => Effect.fail(new Error('Book parsing timed out after 30 seconds')),
    }),
  )
}
