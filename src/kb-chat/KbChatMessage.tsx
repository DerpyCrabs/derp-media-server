import MarkdownIt from 'markdown-it'
import { Show, createEffect, createMemo, onCleanup } from 'solid-js'
import Bot from 'lucide-solid/icons/bot'
import User from 'lucide-solid/icons/user'

const md = new MarkdownIt({ html: false, linkify: true })

export function isMediaPathUnderKb(mediaPath: string, kbRoot: string): boolean {
  const p = mediaPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
  const kb = kbRoot.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
  if (!kb) return false
  return p === kb || p.startsWith(kb + '/')
}

/** KB chat uses media: paths relative to the KB; resolve to full media-library path for navigation. */
export function resolveMediaPathForKbChat(pathRaw: string, kbRoot: string | undefined): string {
  const normalized = pathRaw.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
  if (!kbRoot?.trim()) return normalized
  const kb = kbRoot.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
  if (!kb) return normalized
  if (normalized === kb || normalized.startsWith(kb + '/')) return normalized
  return normalized ? `${kb}/${normalized}` : kb
}

function rewriteMediaLinks(html: string): string {
  return html.replace(
    /<a href="media:([^"]+)"([^>]*)>/gi,
    (_full, hrefBody: string, rest: string) => {
      const decoded = decodeURIComponent(String(hrefBody).replace(/&amp;/g, '&'))
      const isDir = decoded.endsWith('/') ? '1' : '0'
      const pathRaw = isDir === '1' ? decoded.replace(/\/+$/, '') : decoded
      const enc = encodeURIComponent(pathRaw)
      return `<a href="#" data-kb-media="${enc}" data-kb-dir="${isDir}" class="kb-chat-media-link text-primary underline decoration-primary/50 hover:decoration-primary"${rest}>`
    },
  )
}

function MarkdownContent(props: {
  content: string
  kbRoot?: string
  onMediaLinkClick?: (path: string, isDirectory: boolean) => void
}) {
  let el: HTMLDivElement | undefined
  const html = createMemo(() => rewriteMediaLinks(md.render(props.content)))

  createEffect(() => {
    const h = html()
    const node = el
    if (!node) return

    node.innerHTML = h

    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a[data-kb-media]') as HTMLAnchorElement | null
      if (!a || !node.contains(a)) return
      e.preventDefault()
      const enc = a.getAttribute('data-kb-media')
      if (enc == null) return
      let pathRaw: string
      try {
        pathRaw = decodeURIComponent(enc)
      } catch {
        return
      }
      const isDir = a.getAttribute('data-kb-dir') === '1'
      const kb = props.kbRoot
      const resolved = resolveMediaPathForKbChat(pathRaw, kb)
      if (kb && !isMediaPathUnderKb(resolved, kb)) return
      props.onMediaLinkClick?.(resolved, isDir)
    }

    node.addEventListener('click', onClick)
    onCleanup(() => node.removeEventListener('click', onClick))
  })

  return (
    <div
      ref={(r) => {
        el = r
      }}
      class='prose prose-sm dark:prose-invert markdown-pane-prose max-w-none select-text [&>:first-child]:mt-0 [&>:last-child]:mb-0'
    />
  )
}

function formatAnswerSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return ''
  return `${sec.toFixed(2)}s`
}

export function KbChatMessage(props: {
  role: 'user' | 'assistant'
  content: string
  answerDurationSec?: number
  kbRoot?: string
  onMediaLinkClick?: (path: string, isDirectory: boolean) => void
}) {
  return (
    <div class={`flex gap-2.5 px-3 py-2 ${props.role === 'user' ? 'justify-end' : ''}`}>
      {props.role === 'assistant' && (
        <div class='bg-muted mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full'>
          <Bot class='h-3.5 w-3.5 text-muted-foreground' stroke-width={2} />
        </div>
      )}
      <div
        class={`max-w-[85%] cursor-text select-text rounded-lg px-3 py-2 text-sm ${
          props.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted/50'
        }`}
      >
        {props.role === 'assistant' ? (
          <MarkdownContent
            content={props.content}
            kbRoot={props.kbRoot}
            onMediaLinkClick={props.onMediaLinkClick}
          />
        ) : (
          <p class='m-0 whitespace-pre-wrap'>{props.content}</p>
        )}
        <Show when={props.role === 'assistant' && props.answerDurationSec != null}>
          <p class='text-muted-foreground mt-1.5 mb-0 border-t border-border/60 pt-1.5 text-[0.7rem] tabular-nums'>
            {formatAnswerSeconds(props.answerDurationSec!)}
          </p>
        </Show>
      </div>
      {props.role === 'user' && (
        <div class='bg-primary/10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full'>
          <User class='text-primary h-3.5 w-3.5' stroke-width={2} />
        </div>
      )}
    </div>
  )
}
