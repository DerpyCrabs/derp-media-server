'use client'

import { useState, useEffect, useRef } from 'react'
import { useDynamicFavicon } from '@/lib/use-dynamic-favicon'
import { TextViewer } from '@/components/text-viewer'
import { Download, ZoomIn, ZoomOut, RotateCw, Maximize2, ExternalLink } from 'lucide-react'
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

  const tracked = useRef(false)
  useEffect(() => {
    if (tracked.current) return
    tracked.current = true
    fetch(`/api/share/${token}/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => {})
  }, [token])

  const mediaUrl = `/api/share/${token}/media/.`
  const downloadUrl = `/api/share/${token}/download`

  switch (shareInfo.mediaType) {
    case 'image':
      return (
        <SharedImageViewer name={shareInfo.name} mediaUrl={mediaUrl} downloadUrl={downloadUrl} />
      )
    case 'video':
      return (
        <SharedVideoViewer name={shareInfo.name} mediaUrl={mediaUrl} downloadUrl={downloadUrl} />
      )
    case 'audio':
      return (
        <SharedAudioViewer name={shareInfo.name} mediaUrl={mediaUrl} downloadUrl={downloadUrl} />
      )
    case 'pdf':
      return <SharedPdfViewer name={shareInfo.name} mediaUrl={mediaUrl} downloadUrl={downloadUrl} />
    case 'text':
      return (
        <TextViewer
          shareMode={{
            token,
            shareInfo,
            mediaUrl,
            downloadUrl,
          }}
        />
      )
    default:
      return <SharedDownloadFallback name={shareInfo.name} downloadUrl={downloadUrl} />
  }
}

function SharedImageViewer({
  name,
  mediaUrl,
  downloadUrl,
}: {
  name: string
  mediaUrl: string
  downloadUrl: string
}) {
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [rotation, setRotation] = useState(0)

  return (
    <div className='min-h-screen flex flex-col bg-black'>
      <div className='flex items-center justify-between p-4 bg-black/50 backdrop-blur-sm'>
        <h2 className='text-white text-lg font-medium truncate flex-1'>{name}</h2>
        <div className='flex items-center gap-2'>
          <Button
            variant='ghost'
            size='icon'
            onClick={() => setZoom((z) => Math.max((z === 'fit' ? 100 : z) - 25, 25))}
            className='text-white hover:bg-white/10'
          >
            <ZoomOut className='h-5 w-5' />
          </Button>
          <span className='text-white text-sm min-w-16 text-center'>
            {zoom === 'fit' ? 'Fit' : `${zoom}%`}
          </span>
          <Button
            variant='ghost'
            size='icon'
            onClick={() => setZoom((z) => Math.min((z === 'fit' ? 100 : z) + 25, 400))}
            className='text-white hover:bg-white/10'
          >
            <ZoomIn className='h-5 w-5' />
          </Button>
          <Button
            variant='ghost'
            size='icon'
            onClick={() => {
              setZoom('fit')
              setRotation(0)
            }}
            className='text-white hover:bg-white/10'
            title='Fit to screen'
          >
            <Maximize2 className='h-5 w-5' />
          </Button>
          <Button
            variant='ghost'
            size='icon'
            onClick={() => setRotation((r) => (r + 90) % 360)}
            className='text-white hover:bg-white/10'
          >
            <RotateCw className='h-5 w-5' />
          </Button>
          <div className='w-px h-6 bg-white/20 mx-2' />
          <Button
            variant='ghost'
            size='icon'
            onClick={() => {
              const a = document.createElement('a')
              a.href = `${downloadUrl}`
              a.download = name
              a.click()
            }}
            className='text-white hover:bg-white/10'
          >
            <Download className='h-5 w-5' />
          </Button>
        </div>
      </div>
      <div className='flex-1 flex items-center justify-center overflow-auto p-4'>
        <img
          src={mediaUrl}
          alt={name}
          className='transition-transform duration-200'
          style={{
            ...(zoom === 'fit'
              ? { width: '100%', height: '100%', objectFit: 'contain' as const }
              : {
                  maxWidth: '100%',
                  maxHeight: '100%',
                  width: 'auto',
                  height: 'auto',
                  objectFit: 'none' as const,
                }),
            transform: `scale(${zoom === 'fit' ? 1 : zoom / 100}) rotate(${rotation}deg)`,
          }}
        />
      </div>
    </div>
  )
}

function SharedVideoViewer({
  name,
  mediaUrl,
  downloadUrl,
}: {
  name: string
  mediaUrl: string
  downloadUrl: string
}) {
  return (
    <div className='min-h-screen flex flex-col bg-black'>
      <div className='flex items-center justify-between p-4 bg-black/50 backdrop-blur-sm'>
        <h2 className='text-white text-lg font-medium truncate flex-1'>{name}</h2>
        <Button
          variant='ghost'
          size='icon'
          onClick={() => {
            const a = document.createElement('a')
            a.href = `${downloadUrl}`
            a.download = name
            a.click()
          }}
          className='text-white hover:bg-white/10'
        >
          <Download className='h-5 w-5' />
        </Button>
      </div>
      <div className='flex-1 flex items-center justify-center'>
        <video controls autoPlay className='w-full max-h-[calc(100vh-72px)]' src={mediaUrl}>
          Your browser does not support the video tag.
        </video>
      </div>
    </div>
  )
}

function SharedAudioViewer({
  name,
  mediaUrl,
  downloadUrl,
}: {
  name: string
  mediaUrl: string
  downloadUrl: string
}) {
  return (
    <div className='min-h-screen flex flex-col items-center justify-center p-8'>
      <div className='max-w-md w-full space-y-6 text-center'>
        <h2 className='text-2xl font-medium'>{name}</h2>
        <audio controls autoPlay className='w-full' src={mediaUrl}>
          Your browser does not support the audio tag.
        </audio>
        <Button
          variant='outline'
          onClick={() => {
            const a = document.createElement('a')
            a.href = `${downloadUrl}`
            a.download = name
            a.click()
          }}
        >
          <Download className='h-4 w-4 mr-2' />
          Download
        </Button>
      </div>
    </div>
  )
}

function SharedPdfViewer({
  name,
  mediaUrl,
  downloadUrl,
}: {
  name: string
  mediaUrl: string
  downloadUrl: string
}) {
  return (
    <div className='min-h-screen flex flex-col bg-neutral-900'>
      <div className='flex items-center justify-between p-4 bg-black/50 backdrop-blur-sm'>
        <h2 className='text-white text-lg font-medium truncate flex-1'>{name}</h2>
        <div className='flex items-center gap-2'>
          <Button
            variant='ghost'
            size='icon'
            onClick={() => window.open(mediaUrl, '_blank')}
            className='text-white hover:bg-white/10'
            title='Open in new tab'
          >
            <ExternalLink className='h-5 w-5' />
          </Button>
          <Button
            variant='ghost'
            size='icon'
            onClick={() => {
              const a = document.createElement('a')
              a.href = `${downloadUrl}`
              a.download = name
              a.click()
            }}
            className='text-white hover:bg-white/10'
            title='Download'
          >
            <Download className='h-5 w-5' />
          </Button>
        </div>
      </div>
      <div className='flex-1'>
        <embed
          src={`${mediaUrl}#toolbar=1`}
          type='application/pdf'
          className='w-full h-[calc(100vh-72px)]'
          title={name}
        />
      </div>
    </div>
  )
}

function SharedDownloadFallback({ name, downloadUrl }: { name: string; downloadUrl: string }) {
  return (
    <div className='min-h-screen flex flex-col items-center justify-center p-8'>
      <div className='max-w-md w-full space-y-6 text-center'>
        <h2 className='text-2xl font-medium'>{name}</h2>
        <p className='text-muted-foreground'>This file type cannot be previewed.</p>
        <Button
          onClick={() => {
            const a = document.createElement('a')
            a.href = `${downloadUrl}`
            a.download = name
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
