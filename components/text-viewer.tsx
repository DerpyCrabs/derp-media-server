'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Copy, Check, Edit2, Save, Zap, ZapOff, AlertCircle, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogPopup,
  DialogTitle,
} from '@/components/ui/dialog'
import { TextContent } from '@/components/text-content'
import { isPathEditable, getKnowledgeBaseRoot } from '@/lib/utils'
import { useSettings } from '@/lib/use-settings'

export interface ShareInfoForViewer {
  token: string
  name: string
  path: string
  isDirectory: boolean
  editable: boolean
  mediaType: string
  extension: string
  restrictions?: {
    allowDelete: boolean
    allowUpload: boolean
    allowEdit: boolean
    maxUploadBytes: number
  }
}

interface TextViewerProps {
  editableFolders?: string[]
  shareMode?: {
    token: string
    shareInfo: ShareInfoForViewer
    mediaUrl: string
    downloadUrl: string
    filePath?: string
    onClose?: () => void
  }
}

export function TextViewer({ editableFolders = [], shareMode }: TextViewerProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const isShareMode = !!shareMode
  const viewingPath = isShareMode
    ? (shareMode!.filePath ?? shareMode!.shareInfo.path)
    : searchParams.get('viewing')
  const [copied, setCopied] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [autoSaveError, setAutoSaveError] = useState<string | null>(null)
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const lastServerContentRef = useRef<string | null>(null)
  const prevViewingPathRef = useRef<string | null>(null)

  const shareStorageKey = isShareMode
    ? `share-autosave-${shareMode.token}${shareMode.filePath ? `-${shareMode.filePath.replace(/[/\\]/g, '_')}` : ''}`
    : ''
  const [shareSettings, setShareSettings] = useState(() => {
    if (!isShareMode) return { enabled: true, readOnly: false }
    const key = `share-autosave-${shareMode.token}${shareMode.filePath ? `-${shareMode.filePath.replace(/[/\\]/g, '_')}` : ''}`
    const canEdit =
      shareMode.shareInfo.editable && shareMode.shareInfo.restrictions?.allowEdit !== false
    if (typeof window === 'undefined') return { enabled: true, readOnly: !canEdit }
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const parsed = JSON.parse(raw)
        return {
          enabled: parsed.enabled ?? true,
          readOnly: parsed.readOnly ?? !canEdit,
        }
      }
    } catch {}
    return { enabled: true, readOnly: !canEdit }
  })
  const persistShareSettings = useCallback(
    (enabled: boolean, readOnly?: boolean) => {
      if (!shareStorageKey) return
      setShareSettings((prev) => {
        const next = { ...prev, enabled, ...(readOnly !== undefined && { readOnly }) }
        try {
          localStorage.setItem(shareStorageKey, JSON.stringify(next))
        } catch {}
        return next
      })
    },
    [shareStorageKey],
  )

  const { settings, setAutoSave } = useSettings('', !isShareMode)
  const knowledgeBases = settings.knowledgeBases || []
  const autoSaveEnabled = isShareMode
    ? shareSettings.enabled
    : viewingPath
      ? (settings.autoSave[viewingPath]?.enabled ?? true)
      : true
  const isReadOnly = isShareMode
    ? shareSettings.readOnly
    : viewingPath
      ? settings.autoSave[viewingPath]?.readOnly || false
      : false

  const isEditable = isShareMode
    ? shareMode!.shareInfo.editable && shareMode!.shareInfo.restrictions?.allowEdit !== false
    : isPathEditable(viewingPath || '', editableFolders)

  const fileExtension = viewingPath?.split('.').pop()?.toLowerCase() || ''
  const isMarkdown = fileExtension === 'md'
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

  const textQueryKey = isShareMode
    ? (['share-text', shareMode!.token, viewingPath] as const)
    : (['text-content', viewingPath] as const)

  const {
    data: content = '',
    isLoading: loading,
    error,
  } = useQuery({
    queryKey: textQueryKey,
    queryFn: async () => {
      if (!viewingPath) return ''
      const url = isShareMode
        ? shareMode!.mediaUrl
        : `/api/media/${encodeURIComponent(viewingPath)}`
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to load file')
      return await res.text()
    },
    enabled: !!isText,
    staleTime: 0,
    gcTime: 1000 * 60 * 10,
    refetchOnMount: 'always',
  })

  useEffect(() => {
    if (!viewingPath || loading) return

    // Reset edit state when switching to a different file
    if (prevViewingPathRef.current !== viewingPath) {
      prevViewingPathRef.current = viewingPath
      lastServerContentRef.current = null
      setIsEditing(false)
    }

    const fileReadOnly = isShareMode
      ? shareSettings.readOnly
      : settings.autoSave[viewingPath]?.readOnly || false
    const fileEditable = isShareMode
      ? shareMode!.shareInfo.editable && shareMode!.shareInfo.restrictions?.allowEdit !== false
      : isPathEditable(viewingPath, editableFolders)

    if (fileEditable && !fileReadOnly) {
      const prevContent = lastServerContentRef.current
      lastServerContentRef.current = content

      if (!isEditing) {
        setEditContent(content)
        setIsEditing(true)
      } else if (prevContent !== null && content !== prevContent && editContent === prevContent) {
        // Server content changed (e.g. refetch after share edit) and user hasn't made local edits – load fresh
        setEditContent(content)
      }
    } else {
      setIsEditing(false)
    }
  }, [
    viewingPath,
    content,
    loading,
    editContent,
    isEditing,
    editableFolders,
    settings.autoSave,
    isShareMode,
    shareSettings.readOnly,
    shareMode?.shareInfo.editable,
    shareMode?.shareInfo.restrictions?.allowEdit,
  ])

  const closeViewer = async () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    if (isEditing && autoSaveEnabled && editContent !== content) {
      await handleSave(true)
    }

    const params = new URLSearchParams(searchParams)
    params.delete('viewing')
    router.replace(`/?${params.toString()}`, { scroll: false })
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

  const handleContentChange = (newContent: string) => {
    setEditContent(newContent)
  }

  useEffect(() => {
    if (!isEditing || !autoSaveEnabled || !viewingPath) return
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
  }, [editContent, isEditing, autoSaveEnabled, content, viewingPath])

  const handleBlur = () => {
    if (autoSaveEnabled && editContent !== content) {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
      handleSave(true)
    }
  }

  const toggleAutoSave = () => {
    if (isShareMode) {
      persistShareSettings(!autoSaveEnabled, undefined)
    } else if (viewingPath) {
      setAutoSave(viewingPath, !autoSaveEnabled)
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
    // Preserve the existing auto-save preference; only update the readOnly flag.
    if (isShareMode) {
      persistShareSettings(shareSettings.enabled, newReadOnly)
    } else if (viewingPath) {
      setAutoSave(viewingPath, autoSaveEnabled, newReadOnly)
    }
  }

  const handleSave = async (skipStateUpdate = false) => {
    if (!viewingPath) return

    const saveState = skipStateUpdate ? () => {} : setSaving
    saveState(true)

    if (skipStateUpdate) setAutoSaveError(null)

    try {
      let editPath = ''
      if (isShareMode && shareMode!.filePath) {
        const sharePath = shareMode!.shareInfo.path.replace(/\\/g, '/')
        const fileFwd = shareMode!.filePath.replace(/\\/g, '/')
        editPath = fileFwd.startsWith(sharePath + '/')
          ? fileFwd.slice(sharePath.length + 1)
          : fileFwd
      }
      const res = isShareMode
        ? await fetch(`/api/share/${shareMode!.token}/edit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: editPath, content: editContent }),
          })
        : await fetch('/api/files/edit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: viewingPath, content: editContent }),
          })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save file')
      }

      const queryKey = isShareMode
        ? ['share-text', shareMode!.token, viewingPath]
        : ['text-content', viewingPath]
      queryClient.setQueryData(queryKey, editContent)
      if (!skipStateUpdate) setIsEditing(false)
      await queryClient.invalidateQueries({ queryKey })
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

  const knowledgeBasesRef = useRef(knowledgeBases)
  knowledgeBasesRef.current = knowledgeBases

  const handleImagePaste = useCallback(
    async (base64: string, mimeType: string): Promise<string | null> => {
      if (isShareMode) {
        try {
          const res = await fetch(`/api/share/${shareMode!.token}/upload-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base64Content: base64, mimeType }),
          })
          if (!res.ok) {
            const data = await res.json()
            throw new Error(data.error || 'Failed to upload image')
          }
          const data = await res.json()
          return data.path as string
        } catch (err) {
          console.error('Failed to paste image:', err)
          return null
        }
      }
      if (!viewingPath) return null
      const kbRoot = getKnowledgeBaseRoot(viewingPath, knowledgeBasesRef.current)
      if (!kbRoot) return null

      const ext = mimeType.split('/')[1] || 'png'
      const safeExt = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) ? ext : 'png'
      const fileName = `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`
      const imagePath = `${kbRoot}/images/${fileName}`

      try {
        const res = await fetch('/api/files/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'file', path: imagePath, base64Content: base64 }),
        })
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to save image')
        }
        queryClient.invalidateQueries({ queryKey: ['files', kbRoot] })
        queryClient.invalidateQueries({ queryKey: ['files', `${kbRoot}/images`] })
        return imagePath
      } catch (err) {
        console.error('Failed to paste image:', err)
        return null
      }
    },
    [viewingPath, queryClient, isShareMode, shareMode],
  )

  const resolveImageUrl = useCallback(
    (src: string): string | null => {
      try {
        src = decodeURIComponent(src)
      } catch {}

      if (!src.startsWith('http://') && !src.startsWith('https://') && !src.includes('/')) {
        const kbRoot = getKnowledgeBaseRoot(viewingPath || '', knowledgeBasesRef.current)
        if (kbRoot) {
          src = `${kbRoot}/images/${src}`
        }
      }

      if (isShareMode) {
        if (src.startsWith('http://') || src.startsWith('https://')) return src
        const fileDir = (viewingPath || '').replace(/\\/g, '/').replace(/\/[^/]*$/, '')
        const shareRoot = (shareMode!.shareInfo.path || '').replace(/\\/g, '/')
        const firstSeg = (p: string) => p.split('/').filter(Boolean)[0] ?? ''
        const isAbsolute =
          src.startsWith('/') ||
          (fileDir && (src === fileDir || src.startsWith(fileDir + '/'))) ||
          (shareRoot && (src === shareRoot || src.startsWith(shareRoot + '/'))) ||
          (firstSeg(src) && firstSeg(src) === firstSeg(viewingPath || ''))
        let resolvedPath = isAbsolute
          ? src.startsWith('/')
            ? src.slice(1)
            : src
          : `${fileDir ? fileDir + '/' : ''}${src}`.replace(/\/+/g, '/').replace(/^\/+/, '')
        if (
          shareMode!.shareInfo.isDirectory &&
          shareRoot &&
          resolvedPath.startsWith(shareRoot + '/')
        ) {
          resolvedPath = resolvedPath.slice(shareRoot.length).replace(/^\/+/, '')
        } else if (shareMode!.shareInfo.isDirectory && shareRoot && resolvedPath === shareRoot) {
          return null
        } else if (!shareMode!.shareInfo.isDirectory && resolvedPath !== shareRoot) {
          return null
        }
        const encoded = resolvedPath
          .split('/')
          .filter(Boolean)
          .map((s) => encodeURIComponent(s))
          .join('/')
        return encoded ? `/api/share/${shareMode!.token}/media/${encoded}` : null
      }
      return `/api/media/${src.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`
    },
    [isShareMode, shareMode, viewingPath],
  )

  if (!isText) return null

  const fileName = isShareMode ? shareMode!.shareInfo.name : viewingPath.split(/[/\\]/).pop() || ''

  const headerAndContent = (
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
          {isShareMode ? (
            <>
              <Button
                variant='ghost'
                size='icon'
                onClick={() => {
                  const a = document.createElement('a')
                  a.href = shareMode!.downloadUrl
                  a.download = fileName
                  a.click()
                }}
                title='Download'
              >
                <Download className='h-5 w-5' />
              </Button>
              {shareMode!.onClose && (
                <Button variant='ghost' size='icon' onClick={shareMode!.onClose} title='Close'>
                  <X className='h-5 w-5' />
                </Button>
              )}
            </>
          ) : (
            <Button variant='ghost' size='icon' onClick={closeViewer} title='Close'>
              <X className='h-5 w-5' />
            </Button>
          )}
        </div>
      </div>
      <div className={`flex-1 overflow-hidden ${isShareMode ? 'min-h-[calc(100vh-140px)]' : ''}`}>
        <TextContent
          content={content}
          isEditing={isEditing}
          isMarkdown={isMarkdown}
          editContent={editContent}
          onContentChange={handleContentChange}
          onBlur={handleBlur}
          onImagePaste={
            isShareMode
              ? isEditable
                ? handleImagePaste
                : undefined
              : getKnowledgeBaseRoot(viewingPath || '', knowledgeBases)
                ? handleImagePaste
                : undefined
          }
          resolveImageUrl={resolveImageUrl}
          loading={loading}
          error={error}
          className='h-full'
        />
      </div>
    </>
  )

  if (isShareMode) {
    const wrapped = (
      <>
        <span className='sr-only'>
          <DialogTitle>{fileName}</DialogTitle>
        </span>
        {headerAndContent}
      </>
    )
    if (shareMode!.onClose) {
      return (
        <Dialog open onOpenChange={(open) => !open && shareMode!.onClose!()}>
          <DialogPortal>
            <DialogOverlay className='bg-background/95 backdrop-blur-sm' />
            <DialogPopup className='fixed inset-0 z-50 flex flex-col'>{wrapped}</DialogPopup>
          </DialogPortal>
        </Dialog>
      )
    }
    return <div className='min-h-screen flex flex-col'>{headerAndContent}</div>
  }

  return (
    <Dialog open={!!viewingPath} onOpenChange={(open) => !open && closeViewer()}>
      <DialogPortal>
        <DialogOverlay className='bg-background/95 backdrop-blur-sm' />
        <DialogPopup className='fixed inset-0 z-50 flex flex-col'>
          <span className='sr-only'>
            <DialogTitle>{fileName}</DialogTitle>
          </span>
          {headerAndContent}
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  )
}
