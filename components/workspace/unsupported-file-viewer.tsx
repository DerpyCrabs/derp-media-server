import { FileQuestion, FileText } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { WorkspaceViewerToolbar } from '@/components/workspace/viewer-toolbar'
import { cn } from '@/lib/utils'
import { useMediaUrl } from '@/lib/use-media-url'
import { useNavigationSession } from '@/lib/use-navigation-session'
import type { NavigationSession } from '@/lib/navigation-session'
import type { SourceContext } from '@/lib/source-context'

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'])
const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'json',
  'xml',
  'csv',
  'log',
  'yaml',
  'yml',
  'ini',
  'conf',
  'sh',
  'bat',
  'ps1',
  'js',
  'ts',
  'jsx',
  'tsx',
  'css',
  'scss',
  'html',
  'py',
  'java',
  'c',
  'cpp',
  'h',
  'cs',
  'go',
  'rs',
  'php',
  'rb',
  'swift',
  'kt',
  'sql',
])

interface UnsupportedFileViewerProps {
  session?: NavigationSession
  mediaContext?: SourceContext
}

export function UnsupportedFileViewer({
  session: sessionProp,
  mediaContext,
}: UnsupportedFileViewerProps) {
  const session = useNavigationSession(sessionProp)
  const { state } = session
  const { getDownloadUrl } = useMediaUrl(mediaContext)
  const viewingPath = state.viewing

  if (!viewingPath) return null

  const fileExtension = viewingPath.split('.').pop()?.toLowerCase() ?? ''
  const isImage = IMAGE_EXTENSIONS.has(fileExtension)
  const isPdf = fileExtension === 'pdf'
  const isText = TEXT_EXTENSIONS.has(fileExtension)
  if (isImage || isPdf || isText) return null

  const fileName = viewingPath.split(/[/\\]/).pop() ?? 'file'
  const downloadUrl = getDownloadUrl(viewingPath)

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <WorkspaceViewerToolbar
        left={
          <span className='flex items-center gap-2 text-xs text-muted-foreground'>
            <FileQuestion className='h-4 w-4 shrink-0 text-yellow-500' />
            <span className='truncate'>{fileName}</span>
            {fileExtension ? (
              <span className='shrink-0'>.{fileExtension.toUpperCase()}</span>
            ) : null}
          </span>
        }
      />
      <div className='flex flex-1 flex-col items-center justify-center gap-4 p-6'>
        <FileText className='h-12 w-12 text-muted-foreground opacity-50' />
        <p className='text-center text-sm text-muted-foreground'>
          This file type cannot be previewed.
        </p>
        <a
          href={downloadUrl}
          download={fileName}
          className={cn(buttonVariants({ variant: 'default', size: 'sm' }))}
        >
          Download File
        </a>
      </div>
    </div>
  )
}
