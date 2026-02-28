'use client'

import { useRef, useCallback } from 'react'
import { MarkdownRenderer } from '@/components/markdown-renderer'

export interface TextContentProps {
  content: string
  isEditing: boolean
  isMarkdown: boolean
  editContent: string
  onContentChange: (content: string) => void
  onBlur?: () => void
  onImagePaste?: (base64: string, mimeType: string) => Promise<string | null>
  resolveImageUrl?: (src: string) => string | null
  loading?: boolean
  error?: Error | null
  className?: string
}

export function TextContent({
  content,
  isEditing,
  isMarkdown,
  editContent,
  onContentChange,
  onBlur,
  onImagePaste,
  resolveImageUrl,
  loading = false,
  error = null,
  className = '',
}: TextContentProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!onImagePaste) return

      const items = e.clipboardData?.items
      if (!items) return

      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile()
          if (blob) {
            e.preventDefault()
            const reader = new FileReader()
            reader.onload = async (event) => {
              const result = event.target?.result
              if (result && typeof result === 'string') {
                const base64 = result.split(',')[1]
                const mimeType = item.type
                if (base64) {
                  const path = await onImagePaste(base64, mimeType)
                  if (path && textareaRef.current) {
                    const textarea = textareaRef.current
                    const start = textarea.selectionStart
                    const end = textarea.selectionEnd
                    const before = editContent.slice(0, start)
                    const after = editContent.slice(end)
                    const insertion = `![image](${path})`
                    const newContent = before + insertion + after
                    onContentChange(newContent)
                    setTimeout(() => {
                      textarea.focus()
                      const newPos = start + insertion.length
                      textarea.setSelectionRange(newPos, newPos)
                    }, 0)
                  }
                }
              }
            }
            reader.readAsDataURL(blob)
            return
          }
        }
      }
    },
    [onImagePaste, editContent, onContentChange],
  )

  if (loading) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <p className='text-muted-foreground'>Loading...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className='text-center'>
          <p className='text-destructive mb-2'>Failed to load file</p>
          <p className='text-sm text-muted-foreground'>
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      </div>
    )
  }

  if (isEditing) {
    return (
      <div className={`h-full p-4 ${className}`}>
        <textarea
          ref={textareaRef}
          value={editContent}
          onChange={(e) => onContentChange(e.target.value)}
          onBlur={onBlur}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (
              e.key === 'ArrowLeft' ||
              e.key === 'ArrowRight' ||
              e.key === 'ArrowUp' ||
              e.key === 'ArrowDown' ||
              e.key === 'Home' ||
              e.key === 'End' ||
              e.key === 'PageUp' ||
              e.key === 'PageDown'
            ) {
              e.stopPropagation()
            }
          }}
          className='w-full h-full font-mono text-sm p-4 bg-background border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary'
          placeholder='Enter text...'
          spellCheck={false}
        />
      </div>
    )
  }

  if (isMarkdown) {
    return (
      <div className={`h-full p-4 overflow-auto ${className}`}>
        <div className='w-full p-4 bg-background border rounded-lg min-h-full'>
          <MarkdownRenderer content={content} resolveImageUrl={resolveImageUrl} />
        </div>
      </div>
    )
  }

  return (
    <div className={`h-full p-4 ${className}`}>
      <div className='w-full h-full p-4 bg-background border rounded-lg overflow-auto'>
        <pre className='font-mono text-sm whitespace-pre-wrap wrap-break-word'>{content}</pre>
      </div>
    </div>
  )
}
