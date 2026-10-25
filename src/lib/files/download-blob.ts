import { Effect } from 'effect'

export function downloadBlobEffect(blob: Blob, name: string) {
  return Effect.acquireUseRelease(
    Effect.sync(() => URL.createObjectURL(blob)),
    (url) =>
      Effect.sync(() => {
        const link = document.createElement('a')
        link.href = url
        link.download = name
        document.body.append(link)
        link.click()
        link.remove()
      }).pipe(Effect.andThen(Effect.sleep(60_000))),
    (url) => Effect.sync(() => URL.revokeObjectURL(url)),
  )
}
