import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useUrlState } from '@/lib/use-url-state'
import { useSearchParams } from '@/lib/router'
import { SharedFileViewer } from '@/components/shared-file-viewer'
import { SharedFolderBrowser } from '@/components/shared-folder-browser'
import { SharePasscodeGate } from '@/components/share-passcode-form'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { AlertCircle } from 'lucide-react'
import { queryKeys } from '@/lib/query-keys'

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

interface SharePageProps {
  token: string
}

export function SharePage({ token }: SharePageProps) {
  const { urlState } = useUrlState()
  const rawSearchParams = useSearchParams()
  const passcodeFromUrl = rawSearchParams.get('p') || undefined
  const searchParams = {
    dir: urlState.dir || undefined,
    viewing: urlState.viewing || undefined,
    playing: urlState.playing || undefined,
  }

  const {
    data: shareInfo,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.shareInfo(token),
    queryFn: () => api<ShareInfo>(`/api/share/${token}/info`),
  })

  if (isLoading) return null

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

  const fullShareInfo = { ...shareInfo, token, path: shareInfo.path ?? '' }

  if (shareInfo.needsPasscode && !shareInfo.authorized) {
    return (
      <SharePasscodeGate token={token} shareInfo={fullShareInfo} passcodeFromUrl={passcodeFromUrl}>
        {shareInfo.isDirectory ? (
          <SharedFolderBrowser
            token={token}
            shareInfo={fullShareInfo}
            searchParams={searchParams}
            adminViewMode={shareInfo.adminViewMode || 'list'}
          />
        ) : (
          <SharedFileViewer token={token} shareInfo={fullShareInfo} />
        )}
      </SharePasscodeGate>
    )
  }

  return shareInfo.isDirectory ? (
    <SharedFolderBrowser
      token={token}
      shareInfo={fullShareInfo}
      searchParams={searchParams}
      adminViewMode={shareInfo.adminViewMode || 'list'}
    />
  ) : (
    <SharedFileViewer token={token} shareInfo={fullShareInfo} />
  )
}
