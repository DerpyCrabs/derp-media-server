'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { X, Download, Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogPortal, DialogOverlay, DialogTitle } from '@/components/ui/dialog'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'

export function TextViewer() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const viewingPath = searchParams.get('viewing')
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const closeViewer = () => {
    const params = new URLSearchParams(searchParams)
    params.delete('viewing')
    router.push(`/?${params.toString()}`, { scroll: false })
  }

  // Load text content
  useEffect(() => {
    if (!viewingPath) return

    const fileExtension = viewingPath.split('.').pop()?.toLowerCase() || ''
    const textExtensions = [
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
    ]

    if (!textExtensions.includes(fileExtension)) return

    let cancelled = false

    const loadContent = async () => {
      if (!cancelled) {
        setLoading(true)
        setError(null)
      }

      try {
        const res = await fetch(`/api/media/${encodeURIComponent(viewingPath)}`)
        if (!res.ok) throw new Error('Failed to load file')
        const text = await res.text()
        if (!cancelled) {
          setContent(text)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load file')
          setLoading(false)
        }
      }
    }

    loadContent()

    return () => {
      cancelled = true
    }
  }, [viewingPath])

  const handleDownload = () => {
    if (!viewingPath) return
    const link = document.createElement('a')
    link.href = `/api/media/${encodeURIComponent(viewingPath)}`
    link.download = viewingPath.split(/[/\\]/).pop() || 'file.txt'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleCopy = async () => {
    if (!content) return
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  // Check if the current file is a text file
  const fileExtension = viewingPath?.split('.').pop()?.toLowerCase() || ''
  const textExtensions = [
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
  ]
  const isText = viewingPath && textExtensions.includes(fileExtension)

  if (!isText) return null

  const fileName = viewingPath.split(/[/\\]/).pop() || ''

  return (
    <Dialog open={!!viewingPath} onOpenChange={(open) => !open && closeViewer()}>
      <DialogPortal>
        <DialogOverlay className='bg-background/95 backdrop-blur-sm' />
        <DialogPrimitive.Content
          className='fixed inset-0 z-50 flex flex-col data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0'
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <VisuallyHidden.Root>
            <DialogTitle>{fileName}</DialogTitle>
          </VisuallyHidden.Root>
          {/* Header with controls */}
          <div className='flex items-center justify-between p-4 border-b'>
            <div className='flex-1'>
              <h2 className='text-lg font-medium truncate max-w-md'>{fileName}</h2>
              <p className='text-sm text-muted-foreground'>
                {fileExtension.toUpperCase()} File • {content.split('\n').length} lines
              </p>
            </div>
            <div className='flex items-center gap-2'>
              <Button variant='ghost' size='icon' onClick={handleCopy} title='Copy to clipboard'>
                {copied ? <Check className='h-5 w-5' /> : <Copy className='h-5 w-5' />}
              </Button>
              <Button variant='ghost' size='icon' onClick={handleDownload} title='Download'>
                <Download className='h-5 w-5' />
              </Button>
              <Button variant='ghost' size='icon' onClick={closeViewer} title='Close'>
                <X className='h-5 w-5' />
              </Button>
            </div>
          </div>

          {/* Content area */}
          <div className='flex-1 overflow-hidden'>
            {loading ? (
              <div className='flex items-center justify-center h-full'>
                <p className='text-muted-foreground'>Loading...</p>
              </div>
            ) : error ? (
              <div className='flex items-center justify-center h-full'>
                <div className='text-center'>
                  <p className='text-destructive mb-2'>Failed to load file</p>
                  <p className='text-sm text-muted-foreground'>{error}</p>
                </div>
              </div>
            ) : (
              <ScrollArea className='h-full'>
                <div className='p-6'>
                  <pre className='font-mono text-sm whitespace-pre-wrap wrap-break-word'>
                    {content}
                  </pre>
                </div>
              </ScrollArea>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}
