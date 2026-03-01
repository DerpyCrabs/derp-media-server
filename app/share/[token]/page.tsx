import { getShare, getEffectiveRestrictions } from '@/lib/shares'
import { getMediaType } from '@/lib/media-utils'
import { SharedFileViewer } from '@/components/shared-file-viewer'
import { SharedFolderBrowser } from '@/components/shared-folder-browser'
import { SharePasscodeGate } from '@/components/share-passcode-form'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { AlertCircle } from 'lucide-react'
import { config } from '@/lib/config'
import { promises as fs } from 'fs'
import path from 'path'

interface PageProps {
  params: Promise<{ token: string }>
  searchParams: Promise<{ dir?: string; viewing?: string; playing?: string; p?: string }>
}

async function getAdminViewMode(sharePath: string): Promise<'list' | 'grid'> {
  try {
    const settingsFile = path.join(process.cwd(), 'settings.json')
    const data = await fs.readFile(settingsFile, 'utf-8')
    const allSettings = JSON.parse(data)
    const settings = allSettings[config.mediaDir]
    return settings?.viewModes?.[sharePath] || 'list'
  } catch {
    return 'list'
  }
}

export default async function SharePage({ params, searchParams }: PageProps) {
  const { token } = await params
  const query = await searchParams

  const share = await getShare(token)

  if (!share) {
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

  const name = path.basename(share.path) || share.path
  const extension = share.isDirectory ? '' : path.extname(share.path).slice(1).toLowerCase()
  const mediaType = share.isDirectory ? 'folder' : getMediaType(extension)
  const needsPasscode = Boolean(share.passcode)

  const restrictions = share.editable ? getEffectiveRestrictions(share) : undefined

  const shareInfo = {
    token: share.token,
    name,
    path: share.path,
    isDirectory: share.isDirectory,
    editable: share.editable,
    mediaType,
    extension,
    needsPasscode,
    restrictions,
  }

  const adminViewMode = share.isDirectory ? await getAdminViewMode(share.path) : 'list'

  if (needsPasscode) {
    return (
      <SharePasscodeGate token={token} shareInfo={shareInfo} passcodeFromUrl={query.p}>
        {share.isDirectory ? (
          <SharedFolderBrowser
            token={token}
            shareInfo={shareInfo}
            searchParams={query}
            adminViewMode={adminViewMode}
          />
        ) : (
          <SharedFileViewer token={token} shareInfo={shareInfo} />
        )}
      </SharePasscodeGate>
    )
  }

  return share.isDirectory ? (
    <SharedFolderBrowser
      token={token}
      shareInfo={shareInfo}
      searchParams={query}
      adminViewMode={adminViewMode}
    />
  ) : (
    <SharedFileViewer token={token} shareInfo={shareInfo} />
  )
}
