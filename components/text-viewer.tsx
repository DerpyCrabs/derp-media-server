'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { X, Download, Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

export function TextViewer() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const playingPath = searchParams.get('playing')
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const closeViewer = () => {
    const params = new URLSearchParams(searchParams)
    params.delete('playing')
    params.delete('autoplay')
    router.push(`/?${params.toString()}`, { scroll: false })
  }

  // Close viewer on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && playingPath) {
        closeViewer()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingPath])

  // Load text content
  useEffect(() => {
    if (!playingPath) {
      setContent('')
      setLoading(false)
      return
    }

    const fileExtension = playingPath.split('.').pop()?.toLowerCase() || ''
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

    if (!textExtensions.includes(fileExtension)) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    fetch(`/api/media/${encodeURIComponent(playingPath)}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load file')
        return res.text()
      })
      .then((text) => {
        setContent(text)
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [playingPath])

  const handleDownload = () => {
    if (!playingPath) return
    const link = document.createElement('a')
    link.href = `/api/media/${encodeURIComponent(playingPath)}`
    link.download = playingPath.split(/[/\\]/).pop() || 'file.txt'
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

  if (!playingPath) return null

  // Check if the current file is a text file
  const fileExtension = playingPath.split('.').pop()?.toLowerCase() || ''
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
  const isText = textExtensions.includes(fileExtension)

  if (!isText) return null

  const fileName = playingPath.split(/[/\\]/).pop() || ''

  return (
    <div className='fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col'>
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
              <pre className='font-mono text-sm whitespace-pre-wrap wrap-break-word'>{content}</pre>
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  )
}
