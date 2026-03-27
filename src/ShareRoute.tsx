import { useQuery } from '@tanstack/solid-query'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { Match, Switch, createMemo } from 'solid-js'
import { ShareFileViewer } from './ShareFileViewer'
import { ShareFolderBrowser, type ShareInfoPayload } from './ShareFolderBrowser'
import { SharePasscodeGate } from './SharePasscodeGate'
import { ThemeSwitcher } from './ThemeSwitcher'

type ShareRestrictions = {
  allowDelete: boolean
  allowUpload: boolean
  allowEdit: boolean
  maxUploadBytes: number
}

type ShareInfo = {
  name: string
  path?: string
  isDirectory: boolean
  editable: boolean
  mediaType: string
  extension: string
  needsPasscode: boolean
  authorized: boolean
  restrictions?: ShareRestrictions
  usedBytes?: number
  isKnowledgeBase?: boolean
  knowledgeBaseRoot?: string
  adminViewMode?: 'list' | 'grid'
}

type Props = {
  token: string
}

export function ShareRoute(props: Props) {
  const shareQuery = useQuery(() => ({
    queryKey: queryKeys.shareInfo(props.token),
    queryFn: () => api<ShareInfo>(`/api/share/${props.token}/info`),
  }))

  const sharePayload = createMemo((): ShareInfoPayload | undefined => {
    const data = shareQuery.data
    if (!data || shareQuery.isPending || shareQuery.isError) return undefined
    if (data.needsPasscode && !data.authorized) return undefined
    return {
      name: data.name,
      path: data.path ?? '',
      isDirectory: data.isDirectory,
      editable: data.editable,
      mediaType: data.mediaType,
      extension: data.extension,
      restrictions: data.restrictions,
      isKnowledgeBase: data.isKnowledgeBase,
      ...(data.knowledgeBaseRoot !== undefined && { knowledgeBaseRoot: data.knowledgeBaseRoot }),
      adminViewMode: data.adminViewMode || 'list',
    }
  })

  const folderBrowserProps = createMemo(() => {
    const info = sharePayload()
    if (!info?.isDirectory) return undefined
    return { token: props.token, shareInfo: info }
  })

  const fileViewerProps = createMemo(() => {
    const info = sharePayload()
    if (!info || info.isDirectory) return undefined
    return { token: props.token, shareInfo: info }
  })

  const showNotFound = createMemo(
    () => !shareQuery.isPending && (shareQuery.isError || shareQuery.data == null),
  )

  return (
    <Switch>
      <Match when={shareQuery.isPending}>
        <div class='relative flex min-h-screen items-center justify-center'>
          <ThemeSwitcher variant='floating' />
          <p class='text-muted-foreground text-sm'>Loading…</p>
        </div>
      </Match>
      <Match when={showNotFound()}>
        <div
          class='relative flex min-h-screen items-center justify-center p-4'
          data-testid='share-not-found'
        >
          <ThemeSwitcher variant='floating' />
          <div class='border-destructive max-w-md w-full rounded-xl border p-6'>
            <h1 class='text-destructive text-lg font-semibold'>Share Not Found</h1>
            <p class='text-muted-foreground mt-2 text-sm'>
              This share link is invalid or has been revoked.
            </p>
          </div>
        </div>
      </Match>
      <Match when={shareQuery.data?.needsPasscode && !shareQuery.data?.authorized}>
        <SharePasscodeGate token={props.token} shareName={shareQuery.data!.name} />
      </Match>
      <Match when={folderBrowserProps()} keyed>
        {(p) => <ShareFolderBrowser token={p.token} shareInfo={p.shareInfo} />}
      </Match>
      <Match when={fileViewerProps()} keyed>
        {(p) => <ShareFileViewer token={p.token} shareInfo={p.shareInfo} />}
      </Match>
      <Match when={true}>
        <div class='relative flex min-h-screen items-center justify-center p-4'>
          <ThemeSwitcher variant='floating' />
          <p class='text-muted-foreground text-sm'>Unable to display this share.</p>
        </div>
      </Match>
    </Switch>
  )
}
