import { useEffect, useMemo, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { post } from '@/lib/api'
import { useDynamicFavicon } from '@/lib/use-dynamic-favicon'
import { MediaPlayers } from '@/components/media-players'
import { ThemeSwitcher } from '@/components/theme-switcher'
import { TextViewer } from '@/components/text-viewer'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNavigationSession } from '@/lib/use-navigation-session'
import { useShareFileWatcher } from '@/lib/use-share-file-watcher'
import type { NavigationSession } from '@/lib/navigation-session'
import type { SourceContext } from '@/lib/source-context'

interface ShareInfo {
  token: string
  name: string
  path: string
  isDirectory: boolean
  editable: boolean
  mediaType: string
  extension: string
}

interface SharedFileViewerProps {
  token: string
  shareInfo: ShareInfo
  session?: NavigationSession
}

export function SharedFileViewer({
  token,
  shareInfo,
  session: sessionProp,
}: SharedFileViewerProps) {
  const session = useNavigationSession(sessionProp)
  useShareFileWatcher(token)
  const mediaContext: SourceContext = useMemo(
    () => ({ shareToken: token, sharePath: shareInfo.path }),
    [token, shareInfo.path],
  )

  useDynamicFavicon({}, { rootName: shareInfo.name, state: session.state })

  const { viewFile, playFile } = session

  const viewTrackMutation = useMutation({
    mutationFn: (vars: { token: string }) => post(`/api/share/${vars.token}/view`, vars),
    retry: false,
  })
  const tracked = useRef(false)
  useEffect(() => {
    if (tracked.current) return
    tracked.current = true
    viewTrackMutation.mutate({ token })
  }, [token, viewTrackMutation])

  const triggered = useRef(false)
  useEffect(() => {
    if (triggered.current) return
    triggered.current = true

    const isMedia = shareInfo.mediaType === 'audio' || shareInfo.mediaType === 'video'
    if (isMedia) {
      playFile(shareInfo.path)
    } else if (shareInfo.mediaType === 'image' || shareInfo.mediaType === 'pdf') {
      viewFile(shareInfo.path)
    }
  }, [shareInfo, viewFile, playFile])

  const mediaUrl = `/api/share/${token}/media/.`
  const downloadUrl = `/api/share/${token}/download`

  const shareCtx = { token, shareInfo }

  if (shareInfo.mediaType === 'text') {
    return (
      <>
        <ThemeSwitcher variant='floating' />
        <MediaPlayers
          editableFolders={[]}
          session={session}
          mediaContext={mediaContext}
          shareContext={shareCtx}
        />
        <TextViewer
          session={session}
          mediaContext={mediaContext}
          shareMode={{
            token,
            shareInfo,
            mediaUrl,
            downloadUrl,
          }}
        />
      </>
    )
  }

  const isHandledByPlayers =
    shareInfo.mediaType === 'image' ||
    shareInfo.mediaType === 'pdf' ||
    shareInfo.mediaType === 'video' ||
    shareInfo.mediaType === 'audio'

  if (isHandledByPlayers) {
    return (
      <>
        <ThemeSwitcher variant='floating' />
        <div className='min-h-screen'>
          <MediaPlayers
            editableFolders={[]}
            session={session}
            mediaContext={mediaContext}
            shareContext={shareCtx}
          />
        </div>
      </>
    )
  }

  return (
    <>
      <ThemeSwitcher variant='floating' />
      <div className='min-h-screen flex flex-col items-center justify-center p-8'>
        <MediaPlayers
          editableFolders={[]}
          session={session}
          mediaContext={mediaContext}
          shareContext={shareCtx}
        />
        <div className='max-w-md w-full space-y-6 text-center'>
          <h2 className='text-2xl font-medium'>{shareInfo.name}</h2>
          <p className='text-muted-foreground'>This file type cannot be previewed.</p>
          <Button
            onClick={() => {
              const a = document.createElement('a')
              a.href = downloadUrl
              a.download = shareInfo.name
              a.click()
            }}
          >
            <Download className='h-4 w-4 mr-2' />
            Download File
          </Button>
        </div>
      </div>
    </>
  )
}
