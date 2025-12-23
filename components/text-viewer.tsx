'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { X, Download, Copy, Check, Edit2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogPortal, DialogOverlay, DialogTitle } from '@/components/ui/dialog'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
import { isPathEditable } from '@/lib/utils'

interface TextViewerProps {
  editableFolders: string[]
}

export function TextViewer({ editableFolders }: TextViewerProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const viewingPath = searchParams.get('viewing')
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState<string>('')
  const [saving, setSaving] = useState(false)

  // Check if the viewing file is editable using client-side utility
  const isEditable = isPathEditable(viewingPath || '', editableFolders)

  const closeViewer = () => {
    const params = new URLSearchParams(searchParams)
    params.delete('viewing')
    router.replace(`/?${params.toString()}`, { scroll: false })
  }

  // Load text content and check if editable
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
        setIsEditing(false)
      }

      try {
        // Load file content
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

  const handleEdit = () => {
    setEditContent(content)
    setIsEditing(true)
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setEditContent('')
  }

  const handleSave = async () => {
    if (!viewingPath) return

    setSaving(true)
    try {
      const res = await fetch('/api/files/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'file',
          path: viewingPath,
          content: editContent,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save file')
      }

      // Update content and exit edit mode
      setContent(editContent)
      setIsEditing(false)

      // Verify the save by reloading from server with cache-busting
      try {
        const verifyRes = await fetch(
          `/api/media/${encodeURIComponent(viewingPath)}?t=${Date.now()}`,
          { cache: 'no-store' },
        )
        if (verifyRes.ok) {
          const verifiedText = await verifyRes.text()
          setContent(verifiedText)
        }
      } catch (err) {
        console.error('Failed to verify save:', err)
      }
    } catch (err) {
      console.error('Failed to save:', err)
      alert(err instanceof Error ? err.message : 'Failed to save file')
    } finally {
      setSaving(false)
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
              {isEditing ? (
                <>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={handleCancelEdit}
                    disabled={saving}
                    title='Cancel editing'
                  >
                    Cancel
                  </Button>
                  <Button
                    variant='default'
                    size='sm'
                    onClick={handleSave}
                    disabled={saving}
                    title='Save changes'
                    className='gap-2'
                  >
                    <Save className='h-4 w-4' />
                    {saving ? 'Saving...' : 'Save'}
                  </Button>
                </>
              ) : (
                <>
                  {isEditable && (
                    <Button variant='ghost' size='icon' onClick={handleEdit} title='Edit file'>
                      <Edit2 className='h-5 w-5' />
                    </Button>
                  )}
                  <Button
                    variant='ghost'
                    size='icon'
                    onClick={handleCopy}
                    title='Copy to clipboard'
                  >
                    {copied ? <Check className='h-5 w-5' /> : <Copy className='h-5 w-5' />}
                  </Button>
                  <Button variant='ghost' size='icon' onClick={handleDownload} title='Download'>
                    <Download className='h-5 w-5' />
                  </Button>
                </>
              )}
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
            ) : isEditing ? (
              <div className='h-full p-4'>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className='w-full h-full font-mono text-sm p-4 bg-background border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary'
                  placeholder='Enter text...'
                  spellCheck={false}
                />
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
