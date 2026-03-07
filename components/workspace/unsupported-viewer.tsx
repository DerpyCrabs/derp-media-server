import { useMemo } from 'react'
import { FileQuestion, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatFileSize } from '@/lib/media-utils'
import { FileItem, MediaType } from '@/lib/types'
import { useFiles } from '@/lib/use-files'
import { useMediaUrl } from '@/lib/use-media-url'
import { useNavigationSession } from '@/lib/use-navigation-session'
import type { NavigationSession } from '@/lib/navigation-session'
import type { SourceContext } from '@/lib/source-context'

interface UnsupportedViewerProps {
  session?: NavigationSession
  mediaContext?: SourceContext
}

export function UnsupportedViewer({ session: sessionProp, mediaContext }: UnsupportedViewerProps) {
  const session = useNavigationSession(sessionProp)
  const { state } = session
  const { getMediaUrl } = useMediaUrl(mediaContext)
  const viewingPath = state.viewing
  const currentDir = state.dir || ''
  const { data: allFiles = [] } = useFiles(currentDir, mediaContext)

  const fileInfo = useMemo(() => {
    if (!viewingPath) return null
    const file = allFiles.find((f: FileItem) => f.path === viewingPath)
    if (file && file.type === MediaType.OTHER) return file
    return null
  }, [viewingPath, allFiles])

  if (!fileInfo) return null

  return (
    <div className='flex h-full min-h-0 flex-col p-4'>
      <div className='flex items-center gap-3 border-b pb-3'>
        <FileQuestion className='h-8 w-8 shrink-0 text-yellow-500' />
        <div className='min-w-0'>
          <div className='truncate text-lg font-medium'>{fileInfo.name}</div>
          <div className='text-xs text-muted-foreground'>
            {fileInfo.extension ? `.${fileInfo.extension.toUpperCase()}` : 'Unknown'} file •{' '}
            {formatFileSize(fileInfo.size)}
          </div>
        </div>
      </div>
      <div className='flex flex-1 flex-col items-center justify-center space-y-4 rounded-lg bg-muted/50 p-8 text-center'>
        <FileText className='h-16 w-16 text-muted-foreground opacity-50' />
        <div>
          <h3 className='mb-2 text-lg font-medium'>Unsupported File Type</h3>
          <p className='text-sm text-muted-foreground'>
            This file type is not supported for preview. The media server currently supports video,
            audio, and image files.
          </p>
        </div>
        <div className='pt-2'>
          <Button
            variant='default'
            render={
              <a href={getMediaUrl(fileInfo.path)} download={fileInfo.name}>
                Download File
              </a>
            }
          />
        </div>
      </div>
    </div>
  )
}
