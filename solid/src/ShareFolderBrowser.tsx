import { useMutation, useQuery } from '@tanstack/solid-query'
import { api, post } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import type { FileItem } from '@/lib/types'
import { MediaType } from '@/lib/types'
import { formatFileSize } from '@/lib/media-utils'
import { useMediaPlayer } from '@/lib/use-media-player'
import ArrowUp from 'lucide-solid/icons/arrow-up'
import { For, Show, createMemo, onCleanup, onMount } from 'solid-js'
import { useBrowserHistory } from './browser-history'
import { MainMediaPlayers } from './media/MainMediaPlayers'
import type { TextViewerShareContext } from './media/TextViewerDialog'
import { navigateToFolder, playFile, viewFile } from './lib/url-state-actions'
import { fileIcon } from './lib/use-file-icon'

type ShareRestrictions = {
  allowDelete: boolean
  allowUpload: boolean
  allowEdit: boolean
  maxUploadBytes: number
}

export type ShareInfoPayload = {
  name: string
  path: string
  isDirectory: boolean
  editable: boolean
  mediaType: string
  extension: string
  restrictions?: ShareRestrictions
}

function stripSharePrefix(filePath: string, sharePath: string) {
  const sharePathNorm = sharePath.replace(/\\/g, '/')
  const fwd = filePath.replace(/\\/g, '/')
  return fwd.startsWith(sharePathNorm + '/') ? fwd.slice(sharePathNorm.length + 1) : fwd
}

type Props = {
  token: string
  shareInfo: ShareInfoPayload
}

export function ShareFolderBrowser(props: Props) {
  const history = useBrowserHistory()

  const currentSubDir = createMemo(() => {
    const sp = new URLSearchParams(history().search)
    return sp.get('dir') ?? ''
  })

  const shareContext = createMemo(
    (): TextViewerShareContext => ({
      token: props.token,
      sharePath: props.shareInfo.path,
      isDirectory: props.shareInfo.isDirectory,
    }),
  )

  const shareCanEdit = createMemo(
    () => props.shareInfo.editable && props.shareInfo.restrictions?.allowEdit !== false,
  )

  const filesQuery = useQuery(() => ({
    queryKey: queryKeys.shareFiles(props.token, currentSubDir()),
    queryFn: () =>
      api<{ files: FileItem[] }>(
        `/api/share/${props.token}/files?dir=${encodeURIComponent(currentSubDir())}`,
      ),
  }))

  const files = createMemo(() => filesQuery.data?.files ?? [])

  const viewMutation = useMutation(() => ({
    mutationFn: (relativePath: string) =>
      post(`/api/share/${props.token}/view`, { filePath: relativePath }),
  }))

  onMount(() => {
    useMediaPlayer.getState().setShareContext(props.token, props.shareInfo.path)
  })

  onCleanup(() => {
    useMediaPlayer.getState().clearShareContext()
  })

  function handleParentDirectory() {
    const sub = currentSubDir()
    if (!sub) return
    const parts = sub.split('/').filter(Boolean)
    if (parts.length <= 1) {
      navigateToFolder(null)
    } else {
      navigateToFolder(parts.slice(0, -1).join('/'))
    }
  }

  function handleFileClick(file: FileItem) {
    const strip = (p: string) => stripSharePrefix(p, props.shareInfo.path)
    if (file.isDirectory) {
      navigateToFolder(strip(file.path))
      return
    }

    viewMutation.mutate(strip(file.path))
    const isMediaFile = file.type === MediaType.AUDIO || file.type === MediaType.VIDEO
    if (isMediaFile) {
      useMediaPlayer
        .getState()
        .playFile(file.path, file.type === MediaType.AUDIO ? 'audio' : 'video')
      playFile(file.path)
    } else {
      viewFile(file.path)
    }
  }

  return (
    <>
      <MainMediaPlayers
        shareContext={shareContext()}
        shareCanEdit={shareCanEdit()}
        editableFolders={[]}
      />
      <div class='min-h-screen' data-testid='share-file-browser'>
        <div class='container mx-auto lg:p-4'>
          <div class='ring-foreground/10 bg-card text-card-foreground flex flex-col gap-0 overflow-hidden rounded-none py-0 text-sm shadow-xs ring-1 lg:rounded-xl'>
            <div class='shrink-0 border-b border-border bg-muted/30 p-2'>
              <p class='truncate text-sm font-medium'>{props.shareInfo.name}</p>
            </div>
            <div class='flex flex-col min-h-0 flex-1 overflow-hidden'>
              <Show when={filesQuery.isError}>
                <div class='p-4'>
                  <p class='text-destructive text-sm'>Failed to load files.</p>
                </div>
              </Show>
              <div class='sm:px-4 py-2'>
                <div class='relative w-full overflow-x-auto'>
                  <table class='w-full caption-bottom text-sm'>
                    <tbody class='[&_tr:last-child]:border-0'>
                      <Show when={currentSubDir()}>
                        <tr
                          class='hover:bg-muted/50 cursor-pointer select-none border-b border-border transition-colors'
                          onClick={handleParentDirectory}
                        >
                          <td class='w-12 p-2 align-middle'>
                            <div class='flex items-center justify-center'>
                              <ArrowUp
                                class='h-5 w-5 text-muted-foreground'
                                size={20}
                                stroke-width={2}
                              />
                            </div>
                          </td>
                          <td class='p-2 align-middle font-medium'>..</td>
                          <td class='p-2 align-middle text-right text-muted-foreground' />
                        </tr>
                      </Show>
                      <For each={files()}>
                        {(file) => (
                          <tr
                            class='hover:bg-muted/50 group cursor-pointer select-none border-b border-border transition-colors'
                            onClick={() => handleFileClick(file)}
                          >
                            <td class='w-12 p-2 align-middle'>
                              <div class='flex items-center justify-center'>{fileIcon(file)}</div>
                            </td>
                            <td class='p-2 align-middle font-medium'>
                              <span class='truncate'>{file.name}</span>
                            </td>
                            <td class='p-2 align-middle text-right text-muted-foreground tabular-nums'>
                              <span class='inline-block w-20'>
                                {file.isDirectory ? '' : formatFileSize(file.size)}
                              </span>
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
