import { Effect } from 'effect'
import { modelOwner } from 'effectweb'
import { randomId } from '@/lib/random-id'

const owner = modelOwner({})
export const browserDownloadsLifetime = { dispose: owner.dispose, close: owner.close }
export function downloadBlob(blob: Blob, name: string) {
  owner.run(`download:${randomId()}`, downloadBlobEffect(blob, name), 'drop')
}

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
