import { createSignal, onCleanup, type Accessor } from 'solid-js'
import { extractPasteDataFromClipboardData } from '@/lib/files/extract-paste-data'
import type { PasteData } from '@/lib/files/paste-data'
import type { FileItem } from '@/lib/files/types'
import { shouldOfferPasteAsNewFile } from '@/lib/files/should-offer-paste-as-new-file'
import type { FilePasteVariables, useFileBrowserMutations } from './use-file-browser-mutations'

type PasteMutation = ReturnType<typeof useFileBrowserMutations>['pasteMutation']

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

export function usePasteSession(options: {
  currentPath: Accessor<string>
  files: Accessor<FileItem[]>
  editable: Accessor<boolean>
  inKnowledgeBase: Accessor<boolean>
  mutation: PasteMutation
  onSaved?: (path: string) => void
}) {
  const [session, setSession] = createSignal<{
    data: PasteData
    existingFiles: FileItem[]
  } | null>(null)
  const requests = createLatestPasteRequestGuard()

  function close() {
    requests.cancel()
    setSession(null)
    options.mutation.reset()
  }

  function capture(event: ClipboardEvent) {
    if (!options.editable() || !shouldOfferPasteAsNewFile(event)) return
    event.preventDefault()
    const request = requests.begin()
    void extractPasteDataFromClipboardData(event.clipboardData, {
      textSuggestedExtension: options.inKnowledgeBase() ? 'md' : 'txt',
    }).then((data) => {
      if (!data || !requests.isCurrent(request)) return
      setSession({ data, existingFiles: options.files() })
    })
  }

  function submit(fileName: string, mode: 'create' | 'replace', expectedVersion?: number) {
    const data = session()?.data
    if (!data) return
    const path = options.currentPath() ? `${options.currentPath()}/${fileName}` : fileName
    const variables: FilePasteVariables = { path, mode, expectedVersion }
    if (data.type === 'image' || (data.type === 'file' && !data.isTextContent)) {
      variables.base64Content = data.content
    } else {
      variables.content = data.content
    }
    options.mutation.mutate(variables, {
      onSuccess: () => {
        close()
        options.onSaved?.(path)
      },
    })
  }

  onCleanup(requests.cancel)

  return {
    data: () => session()?.data ?? null,
    open: () => session() !== null,
    existingFiles: () => session()?.existingFiles ?? options.files(),
    capture,
    submit,
    close,
  }
}
