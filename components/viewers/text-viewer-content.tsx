'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Copy, Check, Edit2, Save, Zap, ZapOff, AlertCircle, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TextContent } from '@/components/viewers/text-content'

export interface TextViewerContentProps {
  filePath: string
  onClose?: () => void

  fetchUrl: string
  queryKey: readonly unknown[]
  downloadUrl?: string

  isEditable: boolean
  saveContent?: (content: string) => Promise<void>

  onImagePaste?: (base64: string, mimeType: string) => Promise<string | null>
  resolveImageUrl?: (src: string) => string | null

  autoSaveEnabled: boolean
  onToggleAutoSave: () => void
  isReadOnly: boolean
  onToggleReadOnly: (newReadOnly: boolean) => void

  minContentHeight?: string
}

const TEXT_EXTENSIONS = [
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

export function TextViewerContent({
  filePath,
  onClose,
  fetchUrl,
  queryKey,
  downloadUrl,
  isEditable,
  saveContent,
  onImagePaste,
  resolveImageUrl,
  autoSaveEnabled,
  onToggleAutoSave,
  isReadOnly,
  onToggleReadOnly,
  minContentHeight,
}: TextViewerContentProps) {
  const queryClient = useQueryClient()
  const [copied, setCopied] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [autoSaveError, setAutoSaveError] = useState<string | null>(null)
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const lastServerContentRef = useRef<string | null>(null)
  const prevFilePathRef = useRef<string | null>(null)

  const fileExtension = filePath?.split('.').pop()?.toLowerCase() || ''
  const isMarkdown = fileExtension === 'md'
  const isText = filePath && TEXT_EXTENSIONS.includes(fileExtension)

  const {
    data: content = '',
    isLoading: loading,
    error,
  } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!filePath) return ''
      const res = await fetch(fetchUrl)
      if (!res.ok) throw new Error('Failed to load file')
      return await res.text()
    },
    enabled: !!isText,
    staleTime: 0,
    gcTime: 1000 * 60 * 10,
    refetchOnMount: 'always',
  })

  useEffect(() => {
    if (!filePath || loading) return

    if (prevFilePathRef.current !== filePath) {
      prevFilePathRef.current = filePath
      lastServerContentRef.current = null
      setIsEditing(false)
    }

    if (isEditable && !isReadOnly) {
      const prevContent = lastServerContentRef.current
      lastServerContentRef.current = content

      if (!isEditing) {
        setEditContent(content)
        setIsEditing(true)
      } else if (prevContent !== null && content !== prevContent && editContent === prevContent) {
        setEditContent(content)
      }
    } else {
      setIsEditing(false)
    }
  }, [filePath, content, loading, editContent, isEditing, isEditable, isReadOnly])

  const handleClose = useCallback(async () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    if (isEditing && autoSaveEnabled && editContent !== content && saveContent) {
      try {
        await saveContent(editContent)
      } catch {}
    }
    onClose?.()
  }, [isEditing, autoSaveEnabled, editContent, content, saveContent, onClose])

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

  useEffect(() => {
    if (!isEditing || !autoSaveEnabled || !filePath) return
    if (editContent === content) return
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
    }
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
  }, [editContent, isEditing, autoSaveEnabled, content, filePath])

  const handleBlur = () => {
    if (autoSaveEnabled && editContent !== content) {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
      handleSave(true)
    }
  }

  const toggleReadOnly = () => {
    const newReadOnly = !isReadOnly
    if (newReadOnly) {
      setIsEditing(false)
      setEditContent('')
    } else {
      setEditContent(content)
      setIsEditing(true)
    }
    onToggleReadOnly(newReadOnly)
  }

  const handleSave = async (skipStateUpdate = false) => {
    if (!filePath || !saveContent) return

    const saveState = skipStateUpdate ? () => {} : setSaving
    saveState(true)

    if (skipStateUpdate) setAutoSaveError(null)

    try {
      await saveContent(editContent)
      queryClient.setQueryData([...queryKey], editContent)
      if (!skipStateUpdate) setIsEditing(false)
      await queryClient.invalidateQueries({ queryKey: [...queryKey] })
    } catch (err) {
      console.error('Failed to save:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to save file'

      if (skipStateUpdate) {
        setAutoSaveError(errorMessage)
        setTimeout(() => setAutoSaveError(null), 5000)
      } else {
        alert(errorMessage)
      }
    } finally {
      saveState(false)
    }
  }

  if (!isText) return null

  const fileName = filePath?.split(/[/\\]/).pop() || ''

  return (
    <>
      <div className='flex items-center justify-between gap-4 p-4 border-b shrink-0'>
        <div className='flex-1 min-w-0'>
          <h2 className='text-lg font-medium truncate'>{fileName}</h2>
          <p className='text-sm text-muted-foreground'>
            {fileExtension.toUpperCase()} File{' '}
            {content ? `• ${content.split('\n').length} lines` : ''}
          </p>
        </div>
        <div className='flex items-center gap-2 shrink-0'>
          {isEditing ? (
            <>
              {isEditable && (
                <div className='flex items-center gap-2 mr-2 border-r pr-3'>
                  <Button
                    variant={autoSaveEnabled ? 'default' : 'outline'}
                    size='sm'
                    onClick={onToggleAutoSave}
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
                Read only
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
                <Button variant='default' size='sm' onClick={toggleReadOnly} title='Edit file'>
                  <Edit2 className='h-4 w-4' />
                  <span className='ml-2'>Edit</span>
                </Button>
              )}
              <Button variant='ghost' size='icon' onClick={handleCopy} title='Copy to clipboard'>
                {copied ? <Check className='h-5 w-5' /> : <Copy className='h-5 w-5' />}
              </Button>
            </>
          )}
          {downloadUrl && (
            <Button
              variant='ghost'
              size='icon'
              onClick={() => {
                const a = document.createElement('a')
                a.href = downloadUrl
                a.download = fileName
                a.click()
              }}
              title='Download'
            >
              <Download className='h-5 w-5' />
            </Button>
          )}
          {onClose && (
            <Button variant='ghost' size='icon' onClick={handleClose} title='Close'>
              <X className='h-5 w-5' />
            </Button>
          )}
        </div>
      </div>
      <div
        className='flex-1 overflow-hidden'
        style={minContentHeight ? { minHeight: minContentHeight } : undefined}
      >
        <TextContent
          content={content}
          isEditing={isEditing}
          isMarkdown={isMarkdown}
          editContent={editContent}
          onContentChange={setEditContent}
          onBlur={handleBlur}
          onImagePaste={isEditable ? onImagePaste : undefined}
          resolveImageUrl={resolveImageUrl}
          loading={loading}
          error={error}
          className='h-full'
        />
      </div>
    </>
  )
}
