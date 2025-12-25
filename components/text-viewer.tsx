'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { X, Download, Copy, Check, Edit2, Save, Zap, ZapOff, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogPortal, DialogOverlay, DialogTitle } from '@/components/ui/dialog'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
import { isPathEditable } from '@/lib/utils'
import { useSettings } from '@/lib/use-settings'

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
  const [autoSaveError, setAutoSaveError] = useState<string | null>(null)
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Get settings including auto-save
  const { settings, setAutoSave } = useSettings('')
  const autoSaveEnabled = viewingPath ? (settings.autoSave[viewingPath]?.enabled ?? true) : true // Default to true
  const isReadOnly = viewingPath ? settings.autoSave[viewingPath]?.readOnly || false : false

  // Check if the viewing file is editable using client-side utility
  const isEditable = isPathEditable(viewingPath || '', editableFolders)

  const closeViewer = () => {
    // Clear any pending auto-save timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }

    // Auto-save on close if enabled and there are changes
    if (isEditing && autoSaveEnabled && editContent !== content) {
      handleSave(true)
    }

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
      // Only show loading if we don't have content yet (initial load)
      if (!cancelled && !content) {
        setLoading(true)
        setError(null)
      }

      try {
        // Load file content
        const res = await fetch(`/api/media/${encodeURIComponent(viewingPath)}`)
        if (!res.ok) throw new Error('Failed to load file')
        const text = await res.text()

        if (!cancelled) {
          setContent(text)
          setLoading(false)

          // Check if file is editable and read-only setting
          const isFileEditable = isPathEditable(viewingPath, editableFolders)
          const fileReadOnly = settings.autoSave[viewingPath]?.readOnly || false

          // Start in edit mode by default if editable and not in read-only mode
          if (isFileEditable && !fileReadOnly) {
            setEditContent(text)
            setIsEditing(true)
          } else {
            setIsEditing(false)
          }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingPath, editableFolders, settings.autoSave])

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

  // Handle content change with auto-save
  const handleContentChange = (newContent: string) => {
    setEditContent(newContent)
  }

  // Auto-save effect with debounce
  useEffect(() => {
    if (!isEditing || !autoSaveEnabled || !viewingPath) return
    if (editContent === content) return

    // Clear existing timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
    }

    // Schedule new save after 2 seconds of inactivity
    autoSaveTimerRef.current = setTimeout(() => {
      if (editContent !== content) {
        handleSave(true)
      }
    }, 2000)

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editContent, isEditing, autoSaveEnabled, content, viewingPath])

  // Handle blur event (focus lost) for textarea
  const handleBlur = () => {
    if (autoSaveEnabled && editContent !== content) {
      // Clear pending timer and save immediately
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
      handleSave(true)
    }
  }

  // Toggle auto-save
  const toggleAutoSave = () => {
    if (viewingPath) {
      setAutoSave(viewingPath, !autoSaveEnabled)
    }
  }

  // Toggle read-only mode
  const toggleReadOnly = () => {
    if (viewingPath) {
      const newReadOnly = !isReadOnly
      // When switching to read-only, exit edit mode
      if (newReadOnly) {
        setIsEditing(false)
        setEditContent('')
      } else {
        // When switching to edit mode, enter edit mode with auto-save enabled
        setEditContent(content)
        setIsEditing(true)
        setAutoSave(viewingPath, true, false)
      }
      setAutoSave(viewingPath, !newReadOnly, newReadOnly)
    }
  }

  const handleSave = async (skipStateUpdate = false) => {
    if (!viewingPath) return

    const saveState = skipStateUpdate ? () => {} : setSaving
    saveState(true)

    // Clear any previous auto-save error
    if (skipStateUpdate) {
      setAutoSaveError(null)
    }

    try {
      const res = await fetch('/api/files/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: viewingPath,
          content: editContent,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save file')
      }

      // Update content and exit edit mode (only if manual save)
      setContent(editContent)
      if (!skipStateUpdate) {
        setIsEditing(false)
      }

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
      const errorMessage = err instanceof Error ? err.message : 'Failed to save file'

      if (skipStateUpdate) {
        // Auto-save error - show in UI
        setAutoSaveError(errorMessage)
        // Clear error after 5 seconds
        setTimeout(() => setAutoSaveError(null), 5000)
      } else {
        // Manual save error - show alert
        alert(errorMessage)
      }
    } finally {
      saveState(false)
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
                  {isEditable && (
                    <div className='flex items-center gap-2 mr-2 border-r pr-3'>
                      <Button
                        variant={autoSaveEnabled ? 'default' : 'outline'}
                        size='sm'
                        onClick={toggleAutoSave}
                        className='gap-2'
                        title={autoSaveEnabled ? 'Auto-save enabled' : 'Auto-save disabled'}
                      >
                        {autoSaveEnabled ? (
                          <>
                            <Zap className='h-4 w-4' />
                            <span>Auto-save</span>
                          </>
                        ) : (
                          <>
                            <ZapOff className='h-4 w-4' />
                            <span>Auto-save</span>
                          </>
                        )}
                      </Button>
                      {autoSaveError && (
                        <div
                          className='flex items-center gap-1 text-sm text-destructive'
                          title={autoSaveError}
                        >
                          <AlertCircle className='h-4 w-4' />
                          <span>Save failed</span>
                        </div>
                      )}
                    </div>
                  )}
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={toggleReadOnly}
                    disabled={saving}
                    title='Switch to read-only mode'
                  >
                    {autoSaveEnabled ? 'Read only' : 'Cancel'}
                  </Button>
                  {!autoSaveEnabled && (
                    <Button
                      variant='default'
                      size='sm'
                      onClick={() => handleSave(false)}
                      disabled={saving}
                      title='Save changes'
                      className='gap-2'
                    >
                      <Save className='h-4 w-4' />
                      {saving ? 'Saving...' : 'Save'}
                    </Button>
                  )}
                </>
              ) : (
                <>
                  {isEditable && (
                    <Button variant='ghost' size='sm' onClick={toggleReadOnly} title='Edit file'>
                      <Edit2 className='h-5 w-5' />
                      <span className='ml-2'>Edit</span>
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
                  ref={textareaRef}
                  value={editContent}
                  onChange={(e) => handleContentChange(e.target.value)}
                  onBlur={handleBlur}
                  className='w-full h-full font-mono text-sm p-4 bg-background border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary'
                  placeholder='Enter text...'
                  spellCheck={false}
                />
              </div>
            ) : (
              <div className='h-full p-4'>
                <div className='w-full h-full p-4 bg-background border rounded-lg overflow-auto'>
                  <pre className='font-mono text-sm whitespace-pre-wrap wrap-break-word'>
                    {content}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}
