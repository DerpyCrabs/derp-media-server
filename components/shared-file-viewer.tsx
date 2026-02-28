'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Download,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Maximize2,
  Copy,
  Check,
  Save,
  ExternalLink,
} from 'lucide-react'
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
        <SharedTextViewer
          token={token}
          shareInfo={shareInfo}
          mediaUrl={mediaUrl}
          downloadUrl={downloadUrl}
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

function SharedTextViewer({
  token,
  shareInfo,
  mediaUrl,
  downloadUrl,
}: {
  token: string
  shareInfo: ShareInfo
  mediaUrl: string
  downloadUrl: string
}) {
  const queryClient = useQueryClient()
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null)

  const { data: content = '', isLoading } = useQuery({
    queryKey: ['share-text', token, shareInfo.path],
    queryFn: async () => {
      const res = await fetch(mediaUrl)
      if (!res.ok) throw new Error('Failed to load file')
      return await res.text()
    },
  })

  useEffect(() => {
    if (shareInfo.editable && content) {
      setEditContent(content)
      setIsEditing(true)
    }
  }, [content, shareInfo.editable])

  // Auto-save with debounce
  useEffect(() => {
    if (!isEditing || !shareInfo.editable || editContent === content) return
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      if (editContent !== content) handleSave(true)
    }, 2000)
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editContent, isEditing, content])

  const handleSave = useCallback(
    async (auto = false) => {
      if (!auto) setSaving(true)
      try {
        const res = await fetch(`/api/share/${token}/edit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: '', content: editContent }),
        })
        if (!res.ok) throw new Error('Failed to save')
        queryClient.setQueryData(['share-text', token, shareInfo.path], editContent)
      } catch (err) {
        console.error('Save error:', err)
      } finally {
        if (!auto) setSaving(false)
      }
    },
    [token, shareInfo.path, editContent, queryClient],
  )

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className='min-h-screen flex flex-col'>
      <div className='flex items-center justify-between p-4 border-b'>
        <div>
          <h2 className='text-lg font-medium truncate'>{shareInfo.name}</h2>
          <p className='text-sm text-muted-foreground'>
            {shareInfo.extension.toUpperCase()} File
            {content ? ` \u2022 ${content.split('\n').length} lines` : ''}
          </p>
        </div>
        <div className='flex items-center gap-2'>
          {isEditing && !saving && (
            <Button variant='default' size='sm' onClick={() => handleSave(false)} disabled={saving}>
              <Save className='h-4 w-4 mr-2' />
              Save
            </Button>
          )}
          <Button variant='ghost' size='icon' onClick={handleCopy} title='Copy to clipboard'>
            {copied ? <Check className='h-5 w-5' /> : <Copy className='h-5 w-5' />}
          </Button>
          <Button
            variant='ghost'
            size='icon'
            onClick={() => {
              const a = document.createElement('a')
              a.href = `${downloadUrl}`
              a.download = shareInfo.name
              a.click()
            }}
            title='Download'
          >
            <Download className='h-5 w-5' />
          </Button>
        </div>
      </div>
      <div className='flex-1 p-4'>
        {isLoading ? (
          <div className='flex items-center justify-center h-full'>
            <p className='text-muted-foreground'>Loading...</p>
          </div>
        ) : isEditing ? (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className='w-full h-full min-h-[calc(100vh-140px)] font-mono text-sm p-4 bg-background border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary'
            spellCheck={false}
          />
        ) : (
          <div className='w-full h-full p-4 bg-background border rounded-lg overflow-auto'>
            <pre className='font-mono text-sm whitespace-pre-wrap wrap-break-word'>{content}</pre>
          </div>
        )}
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
