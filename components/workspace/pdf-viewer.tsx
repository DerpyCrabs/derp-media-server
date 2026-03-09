import { Download, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { WorkspaceViewerToolbar } from '@/components/workspace/viewer-toolbar'
import { useMediaUrl } from '@/lib/use-media-url'
import { useNavigationSession } from '@/lib/use-navigation-session'
import type { NavigationSession } from '@/lib/navigation-session'
import type { SourceContext } from '@/lib/source-context'

interface PdfViewerProps {
  session?: NavigationSession
  mediaContext?: SourceContext
}

export function PdfViewer({ session: sessionProp, mediaContext }: PdfViewerProps) {
  const session = useNavigationSession(sessionProp)
  const { state } = session
  const { getMediaUrl, getDownloadUrl } = useMediaUrl(mediaContext)
  const viewingPath = state.viewing

  const handleDownload = () => {
    if (!viewingPath) return
    const link = document.createElement('a')
    link.href = getDownloadUrl(viewingPath)
    link.download = viewingPath.split(/[/\\]/).pop() || 'document.pdf'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleOpenInNewTab = () => {
    if (!viewingPath) return
    window.open(getMediaUrl(viewingPath), '_blank')
  }

  const fileExtension = viewingPath?.split('.').pop()?.toLowerCase() || ''
  const isPdf = viewingPath && fileExtension === 'pdf'

  if (!isPdf) return null

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <WorkspaceViewerToolbar
        right={
          <>
            <Button
              variant='ghost'
              onClick={handleOpenInNewTab}
              title='Open in new tab'
              className='h-7 w-7 p-0'
            >
              <ExternalLink className='h-3.5 w-3.5' />
            </Button>
            <Button
              variant='ghost'
              onClick={handleDownload}
              title='Download'
              className='h-7 w-7 p-0'
            >
              <Download className='h-3.5 w-3.5' />
            </Button>
          </>
        }
      />
      <div className='flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-neutral-800'>
        <embed
          src={`${getMediaUrl(viewingPath)}#toolbar=1`}
          type='application/pdf'
          className='h-full w-full'
          title={viewingPath.split(/[/\\]/).pop() || ''}
        />
      </div>
    </div>
  )
}
