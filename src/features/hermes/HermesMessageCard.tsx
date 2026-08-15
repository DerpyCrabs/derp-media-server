import type { HermesMessage, HermesToolCall } from '@/features/hermes/hermes-session-store'
import Bot from 'lucide-solid/icons/bot'
import Braces from 'lucide-solid/icons/braces'
import CheckSquare from 'lucide-solid/icons/square-check-big'
import FileCode from 'lucide-solid/icons/file-code-2'
import GitCompare from 'lucide-solid/icons/git-compare-arrows'
import ImageIcon from 'lucide-solid/icons/image'
import Search from 'lucide-solid/icons/search'
import Terminal from 'lucide-solid/icons/terminal'
import Users from 'lucide-solid/icons/users'
import MoreHorizontal from 'lucide-solid/icons/ellipsis'
import LoaderCircle from 'lucide-solid/icons/loader-circle'
import CircleCheck from 'lucide-solid/icons/circle-check'
import { Errored, For, Show } from '@solidjs/web'
import { createMemo, createSignal, onSettled } from 'solid-js'
import { classifyHermesTool, hermesImageUrl } from '@/features/hermes/hermes-chat-parity'
import { LazyMarkdownDocument } from '@/lib/markdown/LazyMarkdownDocument'

const LARGE_OUTPUT_CHARS = 8_000

function displayHermesValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    return String(value)
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

function toolPresentation(name: string) {
  switch (classifyHermesTool(name)) {
    case 'command':
      return { Icon: Terminal, label: 'Command' }
    case 'changes':
      return { Icon: GitCompare, label: 'Changes' }
    case 'search':
      return { Icon: Search, label: 'Search' }
    case 'tasks':
      return { Icon: CheckSquare, label: 'Tasks' }
    case 'image':
      return { Icon: ImageIcon, label: 'Image' }
    case 'delegation':
      return { Icon: Users, label: 'Delegation' }
    case 'file':
      return { Icon: FileCode, label: 'File' }
    case 'generic':
      return { Icon: Braces, label: 'Tool' }
  }
  return { Icon: Braces, label: 'Tool' }
}

function downloadText(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${name.replace(/[^a-z0-9._-]+/gi, '-') || 'tool-output'}.txt`
  anchor.click()
  URL.revokeObjectURL(url)
}

function ToolCard(props: {
  call?: HermesToolCall
  message?: HermesMessage
  onOpenImage?: (src: string) => void
}) {
  const [expanded, setExpanded] = createSignal(false)
  const name = () => props.call?.name ?? props.message?.toolName ?? 'Unknown tool'
  const content = () => props.call?.result ?? props.call?.arguments ?? props.message?.text ?? ''
  const input = () => props.message?.toolInput ?? props.call?.arguments ?? ''
  const presentation = () => toolPresentation(name())
  const parsed = createMemo<Record<string, unknown> | null>(() => {
    try {
      const value = JSON.parse(content())
      return value && typeof value === 'object' && !Array.isArray(value) ? value : null
    } catch {
      return null
    }
  })
  const summary = () => {
    const value = parsed()
    if (!value) return ''
    for (const key of [
      'command',
      'path',
      'file_path',
      'query',
      'pattern',
      'prompt',
      'task',
      'description',
    ]) {
      if (typeof value[key] === 'string') return String(value[key])
    }
    return ''
  }
  const imageSource = () => {
    if (classifyHermesTool(name()) !== 'image') return null
    try {
      const parsed = JSON.parse(content())
      const queue: unknown[] = [parsed]
      let raw: unknown
      while (queue.length && !raw) {
        const value = queue.shift()
        if (Array.isArray(value)) queue.push(...value)
        else if (value && typeof value === 'object') {
          const record = value as Record<string, unknown>
          raw = record.image_url ?? record.imageUrl ?? record.image_path ?? record.path
          queue.push(...Object.values(record))
        }
      }
      return typeof raw === 'string' ? hermesImageUrl(raw) : null
    } catch {
      return hermesImageUrl(content())
    }
  }
  const taskItems = createMemo<unknown[]>(() => {
    if (classifyHermesTool(name()) !== 'tasks') return []
    const value = parsed()
    const items = value?.todos ?? value?.tasks ?? value?.items
    return Array.isArray(items) ? items : []
  })
  const searchItems = createMemo<unknown[]>(() => {
    if (classifyHermesTool(name()) !== 'search') return []
    const value = parsed()
    const items = value?.results ?? value?.matches
    return Array.isArray(items) ? items.slice(0, 20) : []
  })
  const structuredText = createMemo(() => {
    const value = parsed()
    if (!value) return ''
    const kind = classifyHermesTool(name())
    const stringValue = (...keys: string[]) => {
      for (const key of keys) if (typeof value[key] === 'string') return String(value[key])
      return ''
    }
    if (kind === 'command') {
      const command = stringValue('command', 'cmd')
      const stdout = stringValue('stdout', 'output', 'result', 'content')
      const stderr = stringValue('stderr', 'error')
      const exitCode = value.exit_code ?? value.exitCode
      return [
        command ? `$ ${command}` : '',
        stdout,
        stderr,
        exitCode != null ? `exit ${displayHermesValue(exitCode)}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    }
    if (kind === 'file') {
      const path = stringValue('path', 'file_path', 'file')
      const body = stringValue('content', 'result', 'output', 'text')
      return [path, body].filter(Boolean).join('\n\n')
    }
    if (kind === 'delegation') {
      const task = stringValue('task', 'prompt', 'description')
      const result = stringValue('result', 'output', 'content', 'summary')
      return [task, result].filter(Boolean).join('\n\n')
    }
    return ''
  })
  const hasStructuredOutput = () =>
    !!imageSource() ||
    !!props.call?.inlineDiff ||
    !!props.message?.inlineDiff ||
    taskItems().length > 0 ||
    searchItems().length > 0 ||
    !!structuredText()
  const downloadableText = () => structuredText() || content()
  return (
    <details
      data-testid='hermes-tool-card'
      class='rounded-md border border-border/70 bg-muted/20 text-[11px]'
    >
      <summary
        class='flex min-h-7 cursor-pointer list-none items-center gap-1.5 px-2 py-1'
        title={presentation().label}
      >
        {(() => {
          const Icon = presentation().Icon
          return <Icon class='h-3.5 w-3.5 text-violet-500' />
        })()}
        <span class='truncate font-medium text-muted-foreground'>{name()}</span>
        <Show when={summary()}>
          <span class='min-w-0 truncate opacity-60'>· {summary()}</span>
        </Show>
        <Show when={(props.call?.status ?? props.message?.toolStatus) === 'running'}>
          <LoaderCircle class='ml-auto h-3 w-3 animate-spin text-violet-500' />
        </Show>
        <Show when={(props.call?.status ?? props.message?.toolStatus) === 'complete'}>
          <CircleCheck class='ml-auto h-3 w-3 text-emerald-500' />
        </Show>
      </summary>
      <div class='border-t border-border/70 p-2'>
        <Show when={imageSource()}>
          {(src) => (
            <button
              class='mb-2 block max-w-full overflow-hidden rounded-md border border-border bg-black/5'
              onClick={() => props.onOpenImage?.(src())}
            >
              <img
                src={src()}
                alt={name()}
                class='max-h-64 max-w-full object-contain'
                loading='lazy'
              />
            </button>
          )}
        </Show>
        <Show when={props.message?.toolInput && props.message?.toolInput !== content()}>
          <div class='mb-1 text-[10px] uppercase tracking-wide text-muted-foreground'>Input</div>
          <pre class='mb-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-1.5 font-mono text-[11px]'>
            {input()}
          </pre>
        </Show>
        <Show when={props.call?.inlineDiff ?? props.message?.inlineDiff}>
          <div class='mb-1 text-[10px] uppercase tracking-wide text-muted-foreground'>Changes</div>
          <pre class='mb-2 max-h-72 overflow-auto whitespace-pre font-mono text-[11px] text-emerald-600 dark:text-emerald-400'>
            {props.call?.inlineDiff ?? props.message?.inlineDiff}
          </pre>
        </Show>
        <Show when={taskItems().length}>
          <div class='mb-2 space-y-1'>
            <For each={taskItems()}>
              {(item) => {
                const row =
                  item && typeof item === 'object'
                    ? (item as Record<string, unknown>)
                    : { content: item }
                const done =
                  row.completed === true || row.status === 'completed' || row.status === 'done'
                return (
                  <div class='flex gap-1.5'>
                    <span>{done ? '✓' : '○'}</span>
                    <span class={done ? 'line-through opacity-60' : ''}>
                      {displayHermesValue(row.content ?? row.text ?? row.title)}
                    </span>
                  </div>
                )
              }}
            </For>
          </div>
        </Show>
        <Show when={searchItems().length}>
          <div class='mb-2 space-y-1'>
            <For each={searchItems()}>
              {(item) => {
                const row =
                  item && typeof item === 'object'
                    ? (item as Record<string, unknown>)
                    : { text: item }
                return (
                  <div
                    class='truncate rounded bg-background/60 px-1.5 py-1'
                    title={displayHermesValue(row.path ?? row.file ?? row.text)}
                  >
                    {displayHermesValue(row.path ?? row.file ?? row.text ?? row.content)}
                  </div>
                )
              }}
            </For>
          </div>
        </Show>
        <Show when={structuredText()}>
          <pre class='max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-1.5 font-mono text-[11px]'>
            {downloadableText().length > LARGE_OUTPUT_CHARS && !expanded()
              ? `${downloadableText().slice(0, LARGE_OUTPUT_CHARS)}\n\n… output truncated in preview`
              : downloadableText()}
          </pre>
        </Show>
        <Show when={!hasStructuredOutput()}>
          <pre class='max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]'>
            {content().length > LARGE_OUTPUT_CHARS && !expanded()
              ? `${content().slice(0, LARGE_OUTPUT_CHARS)}\n\n… output truncated in preview`
              : content()}
          </pre>
        </Show>
        <Show when={downloadableText().length > LARGE_OUTPUT_CHARS}>
          <div class='mt-2 flex gap-2'>
            <button
              class='rounded border border-border px-2 py-1 text-muted-foreground hover:text-foreground'
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded() ? 'Collapse output' : 'Expand full output'}
            </button>
            <button
              class='rounded border border-border px-2 py-1 text-muted-foreground hover:text-foreground'
              onClick={() => downloadText(name(), downloadableText())}
            >
              Download
            </button>
          </div>
        </Show>
      </div>
    </details>
  )
}

function MessageMarkdown(props: {
  text: string
  label: string
  onOpenImage?: (src: string) => void
}) {
  const needsMarkdown = () =>
    /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>|```)|[\u005b\u005d*_~]|https?:\/\//m.test(props.text)
  return (
    <div class='hermes-markdown min-w-0 overflow-hidden'>
      <Show
        when={needsMarkdown()}
        fallback={<div class='whitespace-pre-wrap break-words'>{props.text}</div>}
      >
        <LazyMarkdownDocument
          content={props.text}
          mode='read'
          compact
          resolveImageUrl={hermesImageUrl}
          onOpenImage={(src) => props.onOpenImage?.(src)}
          ariaLabel={props.label}
        />
      </Show>
    </div>
  )
}

function MessageImages(props: { images?: string[]; onOpenImage?: (src: string) => void }) {
  return (
    <Show when={props.images?.length}>
      <div class='mt-1.5 flex flex-wrap gap-1.5'>
        <For each={props.images}>
          {(image) => {
            const src = hermesImageUrl(image)
            return src ? (
              <button
                class='h-20 w-36 max-w-full overflow-hidden rounded-md border border-border bg-black/5'
                onClick={() => props.onOpenImage?.(src)}
              >
                <img
                  src={src}
                  alt='Hermes attachment'
                  class='h-full w-full object-contain'
                  loading='lazy'
                />
              </button>
            ) : null
          }}
        </For>
      </div>
    </Show>
  )
}

export function HermesMessageCard(props: {
  message: HermesMessage
  completedToolCallIds?: ReadonlySet<string>
  onOpenImage?: (src: string) => void
  onEdit?: (message: HermesMessage) => void
  onBranch?: (message: HermesMessage) => void
  onSpeak?: (message: HermesMessage) => void
  onRetry?: () => void
}) {
  let actionsEl: HTMLDetailsElement | undefined
  const closeActionsOutside = (event: PointerEvent) => {
    if (actionsEl && !actionsEl.contains(event.target as Node)) actionsEl.open = false
  }
  const closeActionsOnEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && actionsEl?.open) actionsEl.open = false
  }
  const removeActionsDismissListeners = () => {
    document.removeEventListener('pointerdown', closeActionsOutside, true)
    document.removeEventListener('keydown', closeActionsOnEscape, true)
  }
  const syncActionsDismissListeners = () => {
    removeActionsDismissListeners()
    if (!actionsEl?.open) return
    document.addEventListener('pointerdown', closeActionsOutside, true)
    document.addEventListener('keydown', closeActionsOnEscape, true)
  }
  onSettled(() => removeActionsDismissListeners)
  const pendingToolCalls = createMemo(
    () =>
      props.message.toolCalls?.filter((call) => !props.completedToolCallIds?.has(call.id)) ?? [],
  )
  const hasActivity = () => !!props.message.reasoning || pendingToolCalls().length > 0
  const timestamp = () =>
    props.message.timestamp
      ? new Date(
          props.message.timestamp < 10_000_000_000
            ? props.message.timestamp * 1000
            : props.message.timestamp,
        ).toLocaleString()
      : ''

  return (
    <Errored
      fallback={
        <div class='rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs'>
          This transcript item could not be rendered.
        </div>
      }
    >
      <Show
        when={props.message.role !== 'tool'}
        fallback={<ToolCard message={props.message} onOpenImage={props.onOpenImage} />}
      >
        <div
          title={timestamp()}
          class={`group relative flex min-w-0 gap-1.5 ${props.message.role === 'user' ? 'justify-end' : ''}`}
        >
          <Show when={props.message.role === 'assistant'}>
            <Bot class='mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-500' />
          </Show>
          <div
            class={`min-w-0 max-w-[82%] ${props.message.role === 'user' ? 'rounded-xl rounded-br-sm bg-muted/70 px-2.5 py-1.5' : 'flex-1'}`}
          >
            <Show when={hasActivity()}>
              <details class='mb-1 rounded-md border border-border/60 bg-muted/15 text-[11px] text-muted-foreground'>
                <summary class='flex min-h-6 cursor-pointer list-none items-center gap-1.5 px-2 py-0.5'>
                  <span>Reasoning</span>
                  <Show when={pendingToolCalls().length}>
                    <span class='truncate opacity-70'>
                      · {pendingToolCalls().length} tool{pendingToolCalls().length === 1 ? '' : 's'}
                    </span>
                  </Show>
                </summary>
                <div class='space-y-1 border-t border-border/60 px-2 py-1.5'>
                  <Show when={props.message.reasoning}>
                    <MessageMarkdown
                      text={props.message.reasoning!}
                      label='Hermes reasoning'
                      onOpenImage={props.onOpenImage}
                    />
                  </Show>
                  <For each={pendingToolCalls()}>
                    {(call) => <ToolCard call={call} onOpenImage={props.onOpenImage} />}
                  </For>
                </div>
              </details>
            </Show>
            <Show when={props.message.text}>
              <MessageMarkdown
                text={props.message.text}
                label={`${props.message.role} message`}
                onOpenImage={props.onOpenImage}
              />
            </Show>
            <Show when={props.message.pending && !props.message.text && !hasActivity()}>
              <div class='flex h-6 items-center gap-1.5 text-xs text-muted-foreground'>
                <LoaderCircle class='h-3.5 w-3.5 animate-spin text-violet-500' />
                <span>Working…</span>
              </div>
            </Show>
            <Show when={props.message.pending && (props.message.text || hasActivity())}>
              <LoaderCircle
                class='mt-1 h-3 w-3 animate-spin text-violet-500'
                aria-label='Hermes is working'
              />
            </Show>
            <MessageImages images={props.message.images} onOpenImage={props.onOpenImage} />
            <Show
              when={
                props.message.text ||
                (props.message.role === 'user' && (props.onEdit || props.onBranch)) ||
                props.onRetry ||
                props.onSpeak
              }
            >
              <details
                ref={(element) => {
                  actionsEl = element
                }}
                data-testid='hermes-message-actions'
                class='relative ml-auto h-5 w-fit text-[11px] text-muted-foreground'
                onToggle={syncActionsDismissListeners}
              >
                <summary class='flex h-5 cursor-pointer list-none items-center rounded px-1 opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100'>
                  <MoreHorizontal class='h-3.5 w-3.5' />
                  <span class='sr-only'>Message actions</span>
                </summary>
                <div class='absolute right-0 bottom-full z-30 mb-0.5 flex min-w-28 flex-col rounded-md border border-border bg-popover p-0.5 shadow-sm'>
                  <Show when={props.message.text}>
                    <button
                      class='rounded px-2 py-1 text-left hover:bg-muted hover:text-foreground'
                      onClick={() => void navigator.clipboard.writeText(props.message.text)}
                    >
                      Copy
                    </button>
                  </Show>
                  <Show when={props.onEdit}>
                    <button
                      class='rounded px-2 py-1 text-left hover:bg-muted hover:text-foreground'
                      onClick={() => props.onEdit?.(props.message)}
                    >
                      Edit &amp; rewind
                    </button>
                  </Show>
                  <Show when={props.onBranch}>
                    <button
                      class='rounded px-2 py-1 text-left hover:bg-muted hover:text-foreground'
                      onClick={() => props.onBranch?.(props.message)}
                    >
                      Branch here
                    </button>
                  </Show>
                  <Show when={props.onRetry}>
                    <button
                      class='rounded px-2 py-1 text-left hover:bg-muted hover:text-foreground'
                      onClick={() => props.onRetry?.()}
                    >
                      Retry
                    </button>
                  </Show>
                  <Show
                    when={props.message.role === 'assistant' && props.message.text && props.onSpeak}
                  >
                    <button
                      class='rounded px-2 py-1 text-left hover:bg-muted hover:text-foreground'
                      onClick={() => props.onSpeak?.(props.message)}
                    >
                      Play reply
                    </button>
                  </Show>
                </div>
              </details>
            </Show>
          </div>
        </div>
      </Show>
    </Errored>
  )
}
