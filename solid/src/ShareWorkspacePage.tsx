import { useQuery } from '@tanstack/solid-query'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import type { PinnedTaskbarItem } from '@/lib/use-workspace'
import type { WorkspaceLayoutPreset } from '@/lib/workspace-layout-presets'
import { Match, Switch, createMemo } from 'solid-js'
import { useShareFileWatcher } from './lib/use-share-file-watcher'
import { SharePasscodeGate } from './SharePasscodeGate'
import { WorkspacePage } from './WorkspacePage'

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
  workspaceTaskbarPins?: PinnedTaskbarItem[]
  workspaceLayoutPresets?: WorkspaceLayoutPreset[]
}

type Props = { token: string }

export function ShareWorkspacePage(props: Props) {
  useShareFileWatcher(props.token)

  const shareQuery = useQuery(() => ({
    queryKey: queryKeys.shareInfo(props.token),
    queryFn: () => api<ShareInfo>(`/api/share/${props.token}/info`),
  }))

  const sharePath = createMemo(() => shareQuery.data?.path ?? '')

  const canShowWorkspace = createMemo(() => {
    const d = shareQuery.data
    if (!d?.isDirectory) return false
    if (d.needsPasscode && !d.authorized) return false
    return true
  })

  const shareAllowUpload = createMemo(() => {
    const d = shareQuery.data
    return !!d?.editable && d.restrictions?.allowUpload !== false
  })

  const shareCanDelete = createMemo(() => {
    const d = shareQuery.data
    return !!d?.editable && d.restrictions?.allowDelete !== false
  })

  return (
    <Switch>
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
      <Match
        when={shareQuery.data?.needsPasscode && !shareQuery.data?.authorized && shareQuery.data}
      >
        {(info) => <SharePasscodeGate token={props.token} shareName={info().name} />}
      </Match>
      <Match when={shareQuery.data && !shareQuery.data!.isDirectory}>
        <div class='flex min-h-screen items-center justify-center p-4'>
          <p class='text-muted-foreground text-sm'>
            Workspace is only available for folder shares.
          </p>
        </div>
      </Match>
      <Match when={canShowWorkspace()}>
        <WorkspacePage
          shareConfig={{ token: props.token, sharePath: sharePath() }}
          shareWorkspaceTaskbarPins={shareQuery.data?.workspaceTaskbarPins ?? []}
          shareWorkspaceLayoutPresets={shareQuery.data?.workspaceLayoutPresets ?? []}
          shareAllowUpload={shareAllowUpload()}
          shareIsKnowledgeBase={!!shareQuery.data?.isKnowledgeBase}
          shareCanEdit={
            !!shareQuery.data?.editable && shareQuery.data?.restrictions?.allowEdit !== false
          }
          shareCanDelete={shareCanDelete()}
        />
      </Match>
    </Switch>
  )
}
