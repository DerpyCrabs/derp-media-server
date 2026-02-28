'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownRendererProps {
  content: string
  resolveImageUrl?: (src: string) => string | null
}

export function MarkdownRenderer({ content, resolveImageUrl }: MarkdownRendererProps) {
  return (
    <div className='prose prose-neutral dark:prose-invert max-w-none'>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ src, alt, ...props }) => {
            const srcStr = typeof src === 'string' ? src : null
            if (!srcStr) return null
            const resolved = resolveImageUrl ? resolveImageUrl(srcStr) : srcStr
            if (resolved === null) return null
            return <img src={resolved} alt={alt || ''} {...props} />
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
        {content}
      </ReactMarkdown>
    </div>
  )
}
