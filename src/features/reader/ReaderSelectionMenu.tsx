import Languages from 'lucide-solid/icons/languages'
import RefreshCw from 'lucide-solid/icons/refresh-cw'
import Sparkles from 'lucide-solid/icons/sparkles'
import { Show, createEffect, createResource, createSignal, onCleanup, untrack } from 'solid-js'
import type { ReaderDefaultAction } from './reader-position'
import { MarkdownContent } from './MarkdownContent'
import { readerAiAvailable, runReaderAi } from './reader-ai'
import type { ReaderAiDetail } from './reader-state-client'

export type ReaderSelection = {
  id: number
  kind: 'text' | 'image'
  text: string
  imageData?: string
  x: number
  y: number
  placement: 'above' | 'below'
  maxHeight: number
  anchor?: HTMLElement
  region?: { x: number; y: number; width: number; height: number }
}

export function ReaderSelectionMenu(props: {
  selection: ReaderSelection
  defaultAction: ReaderDefaultAction
  aiDetail: ReaderAiDetail
  onTextChange: (text: string) => void
}) {
  let previewRef: HTMLDivElement | undefined
  let lastAutomaticKey = ''
  let requestId = 0
  const [task, setTask] = createSignal<'define' | 'translate' | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [result, setResult] = createSignal('')
  const [error, setError] = createSignal('')
  const [readerAiEnabled] = createResource(readerAiAvailable)

  const run = async (nextTask: 'define' | 'translate') => {
    const currentRequest = ++requestId
    const selection = props.selection
    setTask(nextTask)
    setBusy(true)
    setResult('')
    setError('')
    try {
      const nextResult = await runReaderAi({
        task: nextTask,
        kind: selection.kind,
        text: selection.text,
        imageData: selection.imageData,
        detail: props.aiDetail,
      })
      if (currentRequest === requestId && props.selection.id === selection.id) setResult(nextResult)
    } catch (reason) {
      if (currentRequest === requestId && props.selection.id === selection.id)
        setError(reason instanceof Error ? reason.message : 'Reader AI failed')
    } finally {
      if (currentRequest === requestId) setBusy(false)
    }
  }

  createEffect(() => {
    const id = props.selection.id
    const action = props.defaultAction
    if (readerAiEnabled() !== true) return
    const key = `${id}:${action}:${props.aiDetail}`
    if (!id || action === 'none' || key === lastAutomaticKey) return
    lastAutomaticKey = key
    void untrack(() => run(action))
  })

  onCleanup(() => {
    requestId += 1
  })

  createEffect(() => {
    const text = props.selection.text
    if (!previewRef || document.activeElement === previewRef || previewRef.textContent === text)
      return
    previewRef.textContent = text
  })

  const shouldRegenerate = (nextTask: 'define' | 'translate') =>
    Boolean(result()) && task() === nextTask
  const previewRows = () => {
    const available = Math.max(1, Math.floor((props.selection.maxHeight - 62) / 28))
    const desired = Math.max(
      1,
      Math.ceil(props.selection.text.length / 72),
      props.selection.text.split('\n').length,
    )
    return Math.min(10, available, desired)
  }
  const runAction = (event: Event, nextTask: 'define' | 'translate') => {
    event.preventDefault()
    event.stopPropagation()
    void run(nextTask)
  }
  const runActionFromKey = (event: KeyboardEvent, nextTask: 'define' | 'translate') => {
    if (event.key === 'Enter' || event.key === ' ') runAction(event, nextTask)
  }
  const style = () => ({
    left: `${Math.max(12, Math.min(props.selection.x, window.innerWidth - 12))}px`,
    top: `${Math.max(12, Math.min(props.selection.y, window.innerHeight - 12))}px`,
    'max-height': `${props.selection.maxHeight}px`,
    transform:
      props.selection.placement === 'above' ? 'translate(-50%, -100%)' : 'translateX(-50%)',
  })

  return (
    <div
      data-testid='reader-selection-menu'
      class='reader-selection-menu fixed z-[80] box-border flex w-[min(460px,calc(100vw-24px))] flex-col gap-[5px] overflow-hidden rounded-lg border border-[#3a3a3a] bg-[#181818] p-1.5 text-[#e8e8e8] shadow-[0_14px_34px_rgb(0_0_0/42%)]'
      style={style()}
      onPointerDown={(event) => {
        if ((event.target as Element | null)?.closest('[data-reader-copyable]'))
          event.stopPropagation()
        else {
          event.preventDefault()
          event.stopPropagation()
        }
      }}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <Show when={props.selection.kind === 'text' && props.selection.text.trim()}>
        <div class='relative min-w-0 rounded-[7px] border border-[#444] bg-[#202020] focus-within:border-[#666]'>
          <div
            ref={(element) => {
              previewRef = element
            }}
            class='reader-selection-preview box-border max-h-44 min-w-0 overflow-auto py-[7px] pr-[76px] pl-2 text-[0.86rem] leading-[1.35] whitespace-pre-wrap text-[#e8e8e8] outline-none [overflow-wrap:anywhere] [scrollbar-color:#555_#181818]'
            style={{ 'min-height': `calc(${previewRows()} * 1.35em + 14px)` }}
            role='textbox'
            aria-label='Selected text'
            aria-multiline='true'
            contentEditable
            spellcheck={false}
            onInput={(event) => props.onTextChange(event.currentTarget.textContent ?? '')}
            onPointerDown={(event) => event.stopPropagation()}
          />
          <div class='absolute top-1/2 right-1 flex -translate-y-1/2 gap-1'>
            <SelectionActionButton
              kind='translate'
              busy={busy() && task() === 'translate'}
              available={readerAiEnabled()}
              regenerate={shouldRegenerate('translate')}
              onPointerDown={runAction}
              onKeyDown={runActionFromKey}
            />
            <SelectionActionButton
              kind='define'
              busy={busy() && task() === 'define'}
              available={readerAiEnabled()}
              regenerate={shouldRegenerate('define')}
              onPointerDown={runAction}
              onKeyDown={runActionFromKey}
            />
          </div>
        </div>
      </Show>
      <Show when={props.selection.kind === 'image'}>
        <div class='flex justify-end gap-1'>
          <SelectionActionButton
            kind='translate'
            busy={busy() && task() === 'translate'}
            available={readerAiEnabled()}
            regenerate={shouldRegenerate('translate')}
            onPointerDown={runAction}
            onKeyDown={runActionFromKey}
          />
          <SelectionActionButton
            kind='define'
            busy={busy() && task() === 'define'}
            available={readerAiEnabled()}
            regenerate={shouldRegenerate('define')}
            onPointerDown={runAction}
            onKeyDown={runActionFromKey}
          />
        </div>
      </Show>
      <Show when={busy()}>
        <div class='flex min-h-[34px] items-center gap-2 rounded-[7px] border border-[#444] bg-[#202020] px-[10px] text-[0.92rem] text-[#e8e8e8]'>
          <span class='h-2 w-2 animate-pulse rounded-full bg-current' />
          {task() === 'translate' ? 'Translating...' : 'Defining...'}
        </div>
      </Show>
      <Show when={error()}>
        <div
          role='alert'
          class='rounded-[7px] border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-300'
        >
          {error()}
        </div>
      </Show>
      <Show when={result()}>
        <div
          data-testid='reader-ai-result'
          data-reader-copyable
          class='reader-selection-result box-border min-h-0 w-0 min-w-full max-w-full max-h-[220px] cursor-text overflow-auto rounded-[7px] border border-[#444] bg-[#202020] px-[10px] py-[9px] text-[0.88rem] leading-[1.42] whitespace-pre-wrap text-[#e8e8e8] select-text [overflow-wrap:anywhere] [scrollbar-color:#555_#181818]'
        >
          <Show
            when={task() === 'translate' && props.aiDetail === 'compact'}
            fallback={<MarkdownContent content={result()} />}
          >
            {result()}
          </Show>
        </div>
      </Show>
    </div>
  )
}

function SelectionActionButton(props: {
  kind: 'define' | 'translate'
  busy: boolean
  available: boolean | undefined
  regenerate: boolean
  onPointerDown: (event: Event, task: 'define' | 'translate') => void
  onKeyDown: (event: KeyboardEvent, task: 'define' | 'translate') => void
}) {
  const label = () =>
    props.regenerate
      ? props.kind === 'translate'
        ? 'Regenerate translation'
        : 'Regenerate definition'
      : props.kind === 'translate'
        ? 'Translate'
        : 'Define'
  const title = () =>
    props.available === false
      ? 'Reader AI unavailable'
      : props.available === undefined
        ? 'Checking Reader AI availability'
        : label()
  return (
    <button
      type='button'
      data-testid={`reader-${props.kind}`}
      title={title()}
      aria-label={label()}
      class='flex size-[30px] shrink-0 items-center justify-center rounded-md text-[#cfcfcf] transition-colors hover:bg-[#363636] hover:text-white disabled:opacity-40'
      disabled={props.busy || props.available !== true}
      onPointerDown={(event) => props.onPointerDown(event, props.kind)}
      onKeyDown={(event) => props.onKeyDown(event, props.kind)}
    >
      <Show
        when={props.regenerate}
        fallback={
          props.kind === 'translate' ? (
            <Languages class='size-[17px]' />
          ) : (
            <Sparkles class='size-[17px]' />
          )
        }
      >
        <RefreshCw class='size-4' />
      </Show>
    </button>
  )
}
