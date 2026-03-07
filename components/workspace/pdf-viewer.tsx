import { Download, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
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

  const fileName = viewingPath.split(/[/\\]/).pop() || ''

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex items-center justify-between gap-4 border-b px-4 py-3'>
        <div className='min-w-0 flex-1'>
          <h2 className='truncate text-base font-medium'>{fileName}</h2>
        </div>
        <div className='flex items-center gap-2'>
          <Button variant='ghost' size='icon' onClick={handleOpenInNewTab} title='Open in new tab'>
            <ExternalLink className='h-5 w-5' />
          </Button>
          <Button variant='ghost' size='icon' onClick={handleDownload} title='Download'>
            <Download className='h-5 w-5' />
          </Button>
        </div>
      </div>
      <div className='flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-neutral-800'>
        <embed
          src={`${getMediaUrl(viewingPath)}#toolbar=1`}
          type='application/pdf'
          className='h-full w-full'
          title={fileName}
        />
      </div>
    </div>
  )
}
