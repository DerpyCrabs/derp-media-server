import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useSearchParams } from '@/lib/router'
import { navigate } from '@/lib/router'
import { SharePasscodeGate } from '@/components/share-passcode-form'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { AlertCircle, Loader2 } from 'lucide-react'
import { queryKeys } from '@/lib/query-keys'
import { ShareWorkspaceContext, type ShareWorkspaceInfo } from '@/lib/share-workspace-context'
import { WorkspacePage } from './WorkspacePage'
import { useMemo } from 'react'

interface ShareRestrictions {
  allowDelete: boolean
  allowUpload: boolean
  allowEdit: boolean
  maxUploadBytes: number
}

interface ShareInfo {
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
  isKnowledgeBase: boolean
  adminViewMode: 'list' | 'grid'
}

interface ShareWorkspacePageProps {
  token: string
}

export function ShareWorkspacePage({ token }: ShareWorkspacePageProps) {
  const rawSearchParams = useSearchParams()
  const passcodeFromUrl = rawSearchParams.get('p') || undefined

  const {
    data: shareInfo,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.shareInfo(token),
    queryFn: () => api<ShareInfo>(`/api/share/${token}/info`),
  })

  if (isLoading) {
    return (
      <div className='min-h-screen flex items-center justify-center'>
        <Loader2 className='h-6 w-6 animate-spin text-muted-foreground' />
      </div>
    )
  }

  if (error || !shareInfo) {
    return (
      <div className='min-h-screen flex items-center justify-center p-4'>
        <Card className='border-destructive max-w-md w-full'>
          <CardHeader>
            <CardTitle className='flex items-center gap-2 text-destructive'>
              <AlertCircle className='h-5 w-5' />
              Share Not Found
            </CardTitle>
            <CardDescription>This share link is invalid or has been revoked.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  if (!shareInfo.isDirectory) {
    navigate(`/share/${token}`, { replace: true })
    return null
  }

  const fullShareInfo = { ...shareInfo, token, path: shareInfo.path ?? '' }

  if (shareInfo.needsPasscode && !shareInfo.authorized) {
    return (
      <SharePasscodeGate token={token} shareInfo={fullShareInfo} passcodeFromUrl={passcodeFromUrl}>
        <ShareWorkspaceContent token={token} shareInfo={fullShareInfo} />
      </SharePasscodeGate>
    )
  }

  return <ShareWorkspaceContent token={token} shareInfo={fullShareInfo} />
}

function ShareWorkspaceContent({
  token,
  shareInfo,
}: {
  token: string
  shareInfo: ShareInfo & { token: string; path: string }
}) {
  const shareWorkspaceInfo: ShareWorkspaceInfo = useMemo(
    () => ({
      token,
      name: shareInfo.name,
      path: shareInfo.path,
      editable: shareInfo.editable,
      restrictions: shareInfo.restrictions,
      isKnowledgeBase: shareInfo.isKnowledgeBase,
    }),
    [token, shareInfo],
  )

  const shareConfig = useMemo(() => ({ token, sharePath: shareInfo.path }), [token, shareInfo.path])

  return (
    <ShareWorkspaceContext.Provider value={shareWorkspaceInfo}>
      <WorkspacePage shareConfig={shareConfig} />
    </ShareWorkspaceContext.Provider>
  )
}
