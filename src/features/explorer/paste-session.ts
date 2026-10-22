import { Effect } from 'effect'
import { modelOwner } from 'effectweb'
import { extractPasteDataFromClipboardData } from '@/lib/files/extract-paste-data'
import type { PasteData } from '@/lib/files/paste-data'
import type { FileItem } from '@/lib/files/types'
import { shouldOfferPasteAsNewFile } from '@/lib/files/should-offer-paste-as-new-file'
import type { FileOperations, FilePasteVariables } from './file-browser-mutations'
export function createLatestPasteRequestGuard() {
  let latest = 0
  return {
    begin: () => ++latest,
    cancel: () => {
      latest++
    },
    isCurrent: (request: number) => request === latest,
  }
}
const clipboardSlot = 'clipboard-paste'
type Context = {
  currentPath: string
  files: readonly FileItem[]
  editable: boolean
  inKnowledgeBase: boolean
}
export function createPasteSession(
  context: () => Context,
  operations: FileOperations,
  onSaved?: (path: string) => void,
) {
  const owner = modelOwner({
    session: null as { data: PasteData; existingFiles: readonly FileItem[] } | null,
  })
  const requests = createLatestPasteRequestGuard()
  const close = () => {
    requests.cancel()
    owner.patch({ session: null })
    owner.run(clipboardSlot, Effect.void, 'replace')
    operations.paste.reset()
  }
  const capture = (event: ClipboardEvent) => {
    const input = context()
    if (!input.editable || !shouldOfferPasteAsNewFile(event)) return
    event.preventDefault()
    const request = requests.begin()
    const pasteData = extractPasteDataFromClipboardData(event.clipboardData, {
      textSuggestedExtension: input.inKnowledgeBase ? 'md' : 'txt',
    })
    owner.run(
      clipboardSlot,
      Effect.gen(function* () {
        const desktop = window.derpDesktop
        if (
          desktop &&
          (yield* Effect.tryPromise({
            try: () => desktop.hasFileClipboard(),
            catch: (error) => error,
          }))
        ) {
          if (requests.isCurrent(request))
            yield* Effect.tryPromise({
              try: () => desktop.paste(input.currentPath),
              catch: (error) => error,
            })
          return
        }
        const data = yield* pasteData
        if (data && requests.isCurrent(request))
          owner.patch({ session: { data, existingFiles: input.files } })
      }).pipe(Effect.catch(() => Effect.void)),
      'replace',
    )
  }
  const submit = (fileName: string, mode: 'create' | 'replace', expectedVersion?: number) => {
    const data = owner.read().session?.data
    if (!data) return
    const input = context(),
      path = input.currentPath ? `${input.currentPath}/${fileName}` : fileName
    const variables: FilePasteVariables = { path, mode, expectedVersion }
    if (data.type === 'image' || (data.type === 'file' && !data.isTextContent))
      variables.base64Content = data.content
    else variables.content = data.content
    void operations.paste.run(variables, () => {
      close()
      onSaved?.(path)
    })
  }
  return {
    source: owner.source,
    read: owner.read,
    dispose: owner.dispose,
    capture,
    submit,
    close,
    snapshot: (state: ReturnType<typeof owner.read>, files: readonly FileItem[]) => ({
      data: state.session?.data ?? null,
      open: state.session !== null,
      existingFiles: [...(state.session?.existingFiles ?? files)],
      capture,
      submit,
      close,
    }),
  }
}
