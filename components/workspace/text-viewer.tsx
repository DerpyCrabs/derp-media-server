import { useEffect, useState, useRef, useCallback } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { post } from '@/lib/api'
import { Copy, Check, Edit2, Save, Zap, ZapOff, AlertCircle, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TextContent } from '@/components/text-content'
import { WorkspaceViewerToolbar } from '@/components/workspace/viewer-toolbar'
import { isPathEditable, getKnowledgeBaseRoot } from '@/lib/utils'
import { useSettings } from '@/lib/use-settings'
import { useMediaUrl } from '@/lib/use-media-url'
import { useNavigationSession } from '@/lib/use-navigation-session'
import type { NavigationSession } from '@/lib/navigation-session'
import type { SourceContext } from '@/lib/source-context'
import { queryKeys } from '@/lib/query-keys'

interface TextViewerProps {
  editableFolders?: string[]
  session?: NavigationSession
  mediaContext?: SourceContext
}

export function TextViewer({
  editableFolders = [],
  session: sessionProp,
  mediaContext,
}: TextViewerProps) {
  const session = useNavigationSession(sessionProp)
  const { state } = session
  const queryClient = useQueryClient()
  const { getMediaUrl, getDownloadUrl, shareToken, sharePath } = useMediaUrl(mediaContext)
  const viewingPath = state.viewing

  const [copied, setCopied] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [autoSaveError, setAutoSaveError] = useState<string | null>(null)
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const lastServerContentRef = useRef<string | null>(null)
  const prevViewingPathRef = useRef<string | null>(null)

  const filesEditMutation = useMutation({
    mutationFn: (vars: { path: string; content: string }) => {
      if (shareToken) {
        const relative = sharePath
          ? vars.path
              .replace(/\\/g, '/')
              .replace(
                new RegExp(
                  `^${sharePath.replace(/\\/g, '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?`,
                ),
                '',
              )
          : vars.path
        return post(`/api/share/${shareToken}/edit`, { path: relative, content: vars.content })
      }
      return post('/api/files/edit', vars)
    },
  })

  const { settings, setAutoSave } = useSettings('')
  const knowledgeBases = settings.knowledgeBases || []
  const autoSaveEnabled = viewingPath ? (settings.autoSave[viewingPath]?.enabled ?? true) : true
  const isReadOnly = viewingPath ? settings.autoSave[viewingPath]?.readOnly || false : false
  const isEditable = isPathEditable(viewingPath || '', editableFolders)

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

  const textQueryKey = queryKeys.textContent(viewingPath!)

  const {
    data: content = '',
    isLoading: loading,
    error,
  } = useQuery({
    queryKey: textQueryKey,
    queryFn: async () => {
      if (!viewingPath) return ''
      const url = getMediaUrl(viewingPath)
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
    if (!viewingPath) {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
      prevViewingPathRef.current = null
      lastServerContentRef.current = null
      setIsEditing(false)
      setEditContent('')
      return
    }
    if (loading) return

    if (prevViewingPathRef.current !== viewingPath) {
      prevViewingPathRef.current = viewingPath
      lastServerContentRef.current = null
      setIsEditing(false)
    }

    const fileReadOnly = settings.autoSave[viewingPath]?.readOnly || false
    const fileEditable = isPathEditable(viewingPath, editableFolders)

    if (fileEditable && !fileReadOnly) {
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
  }, [viewingPath, content, loading, editContent, isEditing, editableFolders, settings.autoSave])

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

  const editContentRef = useRef(editContent)
  editContentRef.current = editContent

  const handleSave = useCallback(
    async (skipStateUpdate = false, contentToSave?: string) => {
      if (!viewingPath) return
      const contentForSave = contentToSave ?? editContent
      const saveState = skipStateUpdate ? () => {} : setSaving
      saveState(true)
      if (skipStateUpdate) setAutoSaveError(null)

      try {
        await filesEditMutation.mutateAsync({ path: viewingPath, content: contentForSave })
        const queryKey = queryKeys.textContent(viewingPath)
        queryClient.setQueryData(queryKey, contentForSave)
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
    },
    [viewingPath, editContent, filesEditMutation, queryClient],
  )
  const handleSaveRef = useRef(handleSave)
  handleSaveRef.current = handleSave

  const scheduleAutoSave = useCallback(() => {
    if (!viewingPath || !autoSaveEnabled || !isEditing) return
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      const toSave = editContentRef.current
      if (toSave !== content) void handleSaveRef.current(true, toSave)
    }, 2000)
  }, [viewingPath, autoSaveEnabled, isEditing, content])

  const handleContentChange = (newContent: string) => {
    setEditContent(newContent)
    scheduleAutoSave()
  }

  const handleBlur = () => {
    if (autoSaveEnabled && editContent !== content) {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
      void handleSave(true)
    }
  }

  const toggleAutoSave = () => {
    if (viewingPath) setAutoSave(viewingPath, !autoSaveEnabled)
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
    if (viewingPath) setAutoSave(viewingPath, autoSaveEnabled, newReadOnly)
  }

  const handleDownload = () => {
    if (!viewingPath) return
    const link = document.createElement('a')
    link.href = getDownloadUrl(viewingPath)
    link.download = viewingPath.split(/[/\\]/).pop() || 'file'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const knowledgeBasesRef = useRef(knowledgeBases)
  knowledgeBasesRef.current = knowledgeBases

  const handleImagePaste = useCallback(
    async (base64: string, mimeType: string): Promise<string | null> => {
      if (!viewingPath) return null
      const kbRoot = getKnowledgeBaseRoot(viewingPath, knowledgeBasesRef.current)
      if (!kbRoot) return null

      const ext = mimeType.split('/')[1] || 'png'
      const safeExt = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) ? ext : 'png'
      const fileName = `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`
      const imagePath = `${kbRoot}/images/${fileName}`

      try {
        const url = shareToken ? `/api/share/${shareToken}/upload-image` : '/api/files/create'
        const body = shareToken
          ? { path: `images/${fileName}`, base64Content: base64 }
          : { type: 'file', path: imagePath, base64Content: base64 }
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to save image')
        }
        if (shareToken) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles(shareToken) })
        } else {
          void queryClient.invalidateQueries({ queryKey: queryKeys.files(kbRoot) })
          void queryClient.invalidateQueries({ queryKey: queryKeys.files(`${kbRoot}/images`) })
        }
        return imagePath
      } catch (err) {
        console.error('Failed to paste image:', err)
        return null
      }
    },
    [viewingPath, queryClient, shareToken],
  )

  const resolveImageUrl = useCallback(
    (src: string): string | null => {
      try {
        src = decodeURIComponent(src)
      } catch {}
      if (!src.startsWith('http://') && !src.startsWith('https://') && !src.includes('/')) {
        const kbRoot = getKnowledgeBaseRoot(viewingPath || '', knowledgeBasesRef.current)
        if (kbRoot) src = `${kbRoot}/images/${src}`
      }
      return getMediaUrl(src)
    },
    [viewingPath, getMediaUrl],
  )

  if (!isText) return null

  const lineCount = content ? content.split('\n').length : 0

  const editingActions = (
    <>
      {isEditable && (
        <>
          <Button
            variant='ghost'
            onClick={toggleAutoSave}
            className='h-7 gap-1 px-2 text-xs'
            title={autoSaveEnabled ? 'Auto-save enabled' : 'Auto-save disabled'}
          >
            {autoSaveEnabled ? (
              <Zap className='h-3.5 w-3.5 text-emerald-400' />
            ) : (
              <ZapOff className='h-3.5 w-3.5 text-muted-foreground' />
            )}
            <span className={autoSaveEnabled ? 'text-emerald-400' : 'text-muted-foreground'}>
              Auto-save
            </span>
          </Button>
          {autoSaveError && (
            <div className='flex items-center gap-1 text-xs text-destructive' title={autoSaveError}>
              <AlertCircle className='h-3.5 w-3.5' />
            </div>
          )}
          <div className='mx-0.5 h-4 w-px bg-border' />
        </>
      )}
      <Button
        variant='ghost'
        onClick={toggleReadOnly}
        disabled={saving}
        title='Switch to read-only mode'
        className='h-7 px-2 text-xs'
      >
        Read only
      </Button>
      {!autoSaveEnabled && (
        <Button
          variant='default'
          onClick={() => handleSave(false)}
          disabled={saving}
          title='Save changes'
          className='h-7 gap-1 px-2 text-xs'
        >
          <Save className='h-3.5 w-3.5' />
          {saving ? 'Saving...' : 'Save'}
        </Button>
      )}
    </>
  )

  const readOnlyActions = (
    <>
      {isEditable && (
        <Button
          variant='default'
          onClick={toggleReadOnly}
          title='Edit file'
          className='h-7 gap-1 px-2 text-xs'
        >
          <Edit2 className='h-3.5 w-3.5' />
          Edit
        </Button>
      )}
      <Button
        variant='ghost'
        onClick={handleCopy}
        title='Copy to clipboard'
        className='h-7 w-7 p-0'
      >
        {copied ? <Check className='h-3.5 w-3.5' /> : <Copy className='h-3.5 w-3.5' />}
      </Button>
    </>
  )

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <WorkspaceViewerToolbar
        left={
          <span className='text-xs text-muted-foreground'>
            {fileExtension.toUpperCase()}
            {lineCount > 0 && <> &middot; {lineCount} lines</>}
          </span>
        }
        right={
          <>
            {isEditing ? editingActions : readOnlyActions}
            <Button
              variant='ghost'
              onClick={handleDownload}
              title='Download'
              className='h-7 w-7 p-0'
            >
              <Download className='h-3.5 w-3.5' />
            </Button>
          </>
        }
      />
      <div className='flex-1 overflow-hidden'>
        <TextContent
          compact
          content={content}
          isEditing={isEditing}
          isMarkdown={isMarkdown}
          editContent={editContent}
          onContentChange={handleContentChange}
          onBlur={handleBlur}
          onImagePaste={
            getKnowledgeBaseRoot(viewingPath || '', knowledgeBases) ? handleImagePaste : undefined
          }
          resolveImageUrl={resolveImageUrl}
          loading={loading}
          error={error}
          className='h-full'
        />
      </div>
    </div>
  )
}
