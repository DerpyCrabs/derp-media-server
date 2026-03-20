import { useQuery } from '@tanstack/solid-query'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { Match, Switch, createMemo } from 'solid-js'
import { useBrowserHistory } from './browser-history'
import { ShareFileViewer } from './ShareFileViewer'
import { ShareFolderBrowser, type ShareInfoPayload } from './ShareFolderBrowser'
import { SharePasscodeGate } from './SharePasscodeGate'

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
  isKnowledgeBase: boolean
  adminViewMode: 'list' | 'grid'
}

function parseShareToken(pathname: string): string | null {
  const m = pathname.match(/^\/share\/([^/]+)/)
  return m?.[1] ?? null
}

export function ShareRoute() {
  const loc = useBrowserHistory()
  const token = createMemo(() => parseShareToken(loc().pathname))

  const shareQuery = useQuery(() => ({
    queryKey: queryKeys.shareInfo(token() ?? ''),
    queryFn: () => api<ShareInfo>(`/api/share/${token()}/info`),
    enabled: !!token(),
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
    }
  })

  const folderBrowserProps = createMemo(() => {
    const t = token()
    const info = sharePayload()
    if (!t || !info?.isDirectory) return undefined
    return { token: t, shareInfo: info }
  })

  const fileViewerProps = createMemo(() => {
    const t = token()
    const info = sharePayload()
    if (!t || !info || info.isDirectory) return undefined
    return { token: t, shareInfo: info }
  })

  return (
    <Switch>
      <Match when={!token()}>
        <div
          class='flex min-h-screen items-center justify-center p-4'
          data-testid='share-invalid-token'
        >
          <p class='text-muted-foreground text-sm'>Invalid share link</p>
        </div>
      </Match>
      <Match when={shareQuery.isPending}>
        <div class='flex min-h-screen items-center justify-center'>
          <p class='text-muted-foreground text-sm'>Loading…</p>
        </div>
      </Match>
      <Match when={shareQuery.isError}>
        <div class='flex min-h-screen items-center justify-center p-4'>
          <div class='border-destructive max-w-md w-full rounded-xl border p-6'>
            <h1 class='text-destructive text-lg font-semibold'>Share Not Found</h1>
            <p class='text-muted-foreground mt-2 text-sm'>
              This share link is invalid or has been revoked.
            </p>
          </div>
        </div>
      </Match>
      <Match when={shareQuery.data?.needsPasscode && !shareQuery.data?.authorized && token()}>
        <SharePasscodeGate token={token()!} shareName={shareQuery.data!.name} />
      </Match>
      <Match when={folderBrowserProps()} keyed>
        {(p) => <ShareFolderBrowser token={p.token} shareInfo={p.shareInfo} />}
      </Match>
      <Match when={fileViewerProps()} keyed>
        {(p) => <ShareFileViewer token={p.token} shareInfo={p.shareInfo} />}
      </Match>
      <Match when={true}>
        <div class='flex min-h-screen items-center justify-center p-4'>
          <p class='text-muted-foreground text-sm'>Unable to display this share.</p>
        </div>
      </Match>
    </Switch>
  )
}
