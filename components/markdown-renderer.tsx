import { useState, useCallback, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { X } from 'lucide-react'

const imageExtRe = /\.(png|jpe?g|gif|webp|svg|bmp|ico|tiff?|avif)$/i

function preprocessObsidianImages(content: string): string {
  return content.replace(/!\[\[([^\]]+)\]\]/g, (_match, inner: string) => {
    const pipeIdx = inner.indexOf('|')
    const filename = (pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner).trim()
    if (!imageExtRe.test(filename)) return _match
    const alt = (pipeIdx >= 0 ? inner.slice(pipeIdx + 1).trim() : filename) || filename
    return `![${alt}](<${filename}>)`
  })
}

interface MarkdownRendererProps {
  content: string
  resolveImageUrl?: (src: string) => string | null
}

export function MarkdownRenderer({ content, resolveImageUrl }: MarkdownRendererProps) {
  const processed = preprocessObsidianImages(content)
  const [expandedImage, setExpandedImage] = useState<string | null>(null)

  const closeExpanded = useCallback(() => setExpandedImage(null), [])

  useEffect(() => {
    if (!expandedImage) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeExpanded()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [expandedImage, closeExpanded])

  const overlay = expandedImage && (
    <div
      role='dialog'
      aria-modal='true'
      aria-label='View image fullscreen'
      tabIndex={0}
      className='absolute inset-0 z-9999 flex items-center justify-center bg-black/90 p-4 cursor-zoom-out'
      onClick={(e) => e.target === e.currentTarget && closeExpanded()}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          closeExpanded()
        }
      }}
    >
      <button
        type='button'
        onClick={closeExpanded}
        className='absolute top-4 right-4 rounded-md p-2 text-white/80 hover:bg-white/10 hover:text-white transition-colors z-10'
        aria-label='Close'
      >
        <X className='h-6 w-6' />
      </button>
      <img
        src={expandedImage}
        alt=''
        className='max-h-full max-w-full object-contain cursor-default'
        draggable={false}
        loading='eager'
      />
    </div>
  )

  return (
    <div className='prose prose-neutral dark:prose-invert max-w-none'>
      {overlay}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ src, alt, className: imgClassName, ...props }) => {
            const srcStr = typeof src === 'string' ? src : null
            if (!srcStr) return null
            const resolved = resolveImageUrl ? resolveImageUrl(srcStr) : srcStr
            if (resolved === null) return null
            return (
              <span
                className='contents cursor-zoom-in [&>img]:cursor-zoom-in'
                role='button'
                tabIndex={0}
                data-no-window-drag
                onPointerDownCapture={(e) => {
                  if (e.button !== 0) return
                  e.preventDefault()
                  e.stopPropagation()
                  setExpandedImage(resolved)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setExpandedImage(resolved)
                  }
                }}
              >
                <img
                  src={resolved}
                  alt={alt || ''}
                  className={`max-w-sm max-h-48 object-contain ${imgClassName || ''}`}
                  draggable={false}
                  {...props}
                />
              </span>
            )
          },
          a: ({ href, children, ...props }) => {
            const isExternal = href?.startsWith('http://') || href?.startsWith('https://')
            return (
              <a
                href={href}
                target={isExternal ? '_blank' : undefined}
                rel={isExternal ? 'noopener noreferrer' : undefined}
                {...props}
              >
                {children}
              </a>
            )
          },
          code: ({ className, children, ...props }) => {
            const isBlock = className?.startsWith('language-')
            if (isBlock) {
              return (
                <code
                  className={`block p-4 rounded-lg bg-muted/50 font-mono text-sm overflow-x-auto ${className ?? ''}`}
                  {...props}
                >
                  {children}
                </code>
              )
            }
            return (
              <code className='px-1.5 py-0.5 rounded bg-muted/50 font-mono text-sm' {...props}>
                {children}
              </code>
            )
          },
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  )
}
