'use client'

import { useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogPopup,
  DialogTitle,
} from '@/components/ui/dialog'
import { TextViewerContent } from '@/components/viewers/text-viewer-content'
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

export function TextViewer({ editableFolders = [], shareMode }: TextViewerProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const isShareMode = !!shareMode

  const viewingPath = isShareMode
    ? (shareMode!.filePath ?? shareMode!.shareInfo.path)
    : searchParams.get('viewing')

  const { settings, setAutoSave } = useSettings('', !isShareMode)
  const knowledgeBases = settings.knowledgeBases || []

  const shareStorageKey = isShareMode
    ? `share-autosave-${shareMode.token}${shareMode.filePath ? `-${shareMode.filePath.replace(/[/\\]/g, '_')}` : ''}`
    : ''

  const [shareSettings, setShareSettings] = useState(() => {
    if (!isShareMode) return { enabled: true, readOnly: false }
    const key = shareStorageKey
    const canEdit =
      shareMode.shareInfo.editable && shareMode.shareInfo.restrictions?.allowEdit !== false
    if (typeof window === 'undefined') return { enabled: true, readOnly: !canEdit }
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const parsed = JSON.parse(raw)
        return { enabled: parsed.enabled ?? true, readOnly: parsed.readOnly ?? !canEdit }
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

  const fileExtension = viewingPath?.split('.').pop()?.toLowerCase() || ''
  const isText = viewingPath && TEXT_EXTENSIONS.includes(fileExtension)
  if (!isText) return null

  const fileName = viewingPath?.split(/[/\\]/).pop() || ''

  const isEditable = isShareMode
    ? shareMode!.shareInfo.editable && shareMode!.shareInfo.restrictions?.allowEdit !== false
    : isPathEditable(viewingPath || '', editableFolders)

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

  const fetchUrl = isShareMode
    ? shareMode!.mediaUrl
    : `/api/media/${encodeURIComponent(viewingPath!)}`

  const queryKey = isShareMode
    ? (['share-text', shareMode!.token, viewingPath] as const)
    : (['text-content', viewingPath] as const)

  const saveContent = isEditable
    ? async (content: string) => {
        if (isShareMode) {
          let editPath = ''
          if (shareMode!.filePath) {
            const sharePath = shareMode!.shareInfo.path.replace(/\\/g, '/')
            const fileFwd = shareMode!.filePath.replace(/\\/g, '/')
            editPath = fileFwd.startsWith(sharePath + '/')
              ? fileFwd.slice(sharePath.length + 1)
              : fileFwd
          }
          const res = await fetch(`/api/share/${shareMode!.token}/edit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: editPath, content }),
          })
          if (!res.ok) {
            const data = await res.json()
            throw new Error(data.error || 'Failed to save file')
          }
        } else {
          const res = await fetch('/api/files/edit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: viewingPath, content }),
          })
          if (!res.ok) {
            const data = await res.json()
            throw new Error(data.error || 'Failed to save file')
          }
        }
      }
    : undefined

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
      const kbRoot = getKnowledgeBaseRoot(viewingPath, knowledgeBases)
      if (!kbRoot) return null

      const ext = mimeType.split('/')[1] || 'png'
      const safeExt = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) ? ext : 'png'
      const imgFileName = `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`
      const imagePath = `${kbRoot}/images/${imgFileName}`

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
    [viewingPath, queryClient, isShareMode, shareMode, knowledgeBases],
  )

  const resolveImageUrl = useCallback(
    (src: string): string | null => {
      try {
        src = decodeURIComponent(src)
      } catch {}

      if (!src.startsWith('http://') && !src.startsWith('https://') && !src.includes('/')) {
        const kbRoot = getKnowledgeBaseRoot(viewingPath || '', knowledgeBases)
        if (kbRoot) src = `${kbRoot}/images/${src}`
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
    [isShareMode, shareMode, viewingPath, knowledgeBases],
  )

  const closeViewer = useCallback(async () => {
    const params = new URLSearchParams(searchParams)
    params.delete('viewing')
    router.replace(`/?${params.toString()}`, { scroll: false })
  }, [searchParams, router])

  const handleToggleAutoSave = () => {
    if (isShareMode) {
      persistShareSettings(!autoSaveEnabled, undefined)
    } else if (viewingPath) {
      setAutoSave(viewingPath, !autoSaveEnabled)
    }
  }

  const handleToggleReadOnly = (newReadOnly: boolean) => {
    if (isShareMode) {
      persistShareSettings(shareSettings.enabled, newReadOnly)
    } else if (viewingPath) {
      setAutoSave(viewingPath, autoSaveEnabled, newReadOnly)
    }
  }

  const shouldShowImagePaste = isShareMode
    ? isEditable
    : !!getKnowledgeBaseRoot(viewingPath || '', knowledgeBases)

  const contentElement = (
    <TextViewerContent
      filePath={viewingPath!}
      onClose={isShareMode ? shareMode!.onClose : closeViewer}
      fetchUrl={fetchUrl}
      queryKey={queryKey}
      downloadUrl={isShareMode ? shareMode!.downloadUrl : undefined}
      isEditable={isEditable}
      saveContent={saveContent}
      onImagePaste={shouldShowImagePaste ? handleImagePaste : undefined}
      resolveImageUrl={resolveImageUrl}
      autoSaveEnabled={autoSaveEnabled}
      onToggleAutoSave={handleToggleAutoSave}
      isReadOnly={isReadOnly}
      onToggleReadOnly={handleToggleReadOnly}
      minContentHeight={isShareMode ? 'calc(100vh - 140px)' : undefined}
    />
  )

  if (isShareMode) {
    if (shareMode!.onClose) {
      return (
        <Dialog open onOpenChange={(open) => !open && shareMode!.onClose!()}>
          <DialogPortal>
            <DialogOverlay className='bg-background/95 backdrop-blur-sm' />
            <DialogPopup className='fixed inset-0 z-50 flex flex-col'>
              <span className='sr-only'>
                <DialogTitle>{fileName}</DialogTitle>
              </span>
              {contentElement}
            </DialogPopup>
          </DialogPortal>
        </Dialog>
      )
    }
    return (
      <div className='min-h-screen flex flex-col'>
        <span className='sr-only'>{fileName}</span>
        {contentElement}
      </div>
    )
  }

  return (
    <Dialog open={!!viewingPath} onOpenChange={(open) => !open && closeViewer()}>
      <DialogPortal>
        <DialogOverlay className='bg-background/95 backdrop-blur-sm' />
        <DialogPopup className='fixed inset-0 z-50 flex flex-col'>
          <span className='sr-only'>
            <DialogTitle>{fileName}</DialogTitle>
          </span>
          {contentElement}
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  )
}
