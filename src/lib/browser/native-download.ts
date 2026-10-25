import { Effect } from 'effect'
export function nativeDownload(blob: Blob, name: string): Effect.Effect<boolean, Error> {
  return Effect.acquireUseRelease(
    Effect.sync(() => URL.createObjectURL(blob)),
    (url) =>
      Effect.tryPromise({
        try: () => window.derpDesktop!.downloadBlob!(url, name),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
    (url) =>
      Effect.sync(() => {
        void window.derpDesktop?.cancelDownload?.(url).catch(() => {})
        URL.revokeObjectURL(url)
      }),
  )
}
