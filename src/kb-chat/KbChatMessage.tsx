import MarkdownIt from 'markdown-it'
import { Show, createEffect, createMemo } from 'solid-js'
import Bot from 'lucide-solid/icons/bot'
import User from 'lucide-solid/icons/user'

const md = new MarkdownIt({ html: false, linkify: true })

function MarkdownContent(props: { content: string }) {
  let el: HTMLDivElement | undefined
  const html = createMemo(() => md.render(props.content))
  createEffect(() => {
    const h = html()
    if (el) el.innerHTML = h
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
          <MarkdownContent content={props.content} />
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
