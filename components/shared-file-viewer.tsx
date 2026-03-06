import { useEffect, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { post } from '@/lib/api'
import { useDynamicFavicon } from '@/lib/use-dynamic-favicon'
import { useUrlState } from '@/lib/use-url-state'
import { useMediaPlayer } from '@/lib/use-media-player'
import { MediaPlayers } from '@/components/media-players'
import { TextViewer } from '@/components/text-viewer'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'

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
}

export function SharedFileViewer({ token, shareInfo }: SharedFileViewerProps) {
  useDynamicFavicon({}, { rootName: shareInfo.name })

  const { viewFile, playFile } = useUrlState()
  const { setShareContext, clearShareContext } = useMediaPlayer()

  useEffect(() => {
    setShareContext(token, shareInfo.path)
    return () => clearShareContext()
  }, [token, shareInfo.path, setShareContext, clearShareContext])

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
        <MediaPlayers editableFolders={[]} shareContext={shareCtx} />
        <TextViewer
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
      <div className='min-h-screen'>
        <MediaPlayers editableFolders={[]} shareContext={shareCtx} />
      </div>
    )
  }

  return (
    <div className='min-h-screen flex flex-col items-center justify-center p-8'>
      <MediaPlayers editableFolders={[]} shareContext={shareCtx} />
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
  )
}
