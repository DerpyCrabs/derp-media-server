import Languages from '@effectweb/lucide/icons/languages'
import RefreshCw from '@effectweb/lucide/icons/refresh-cw'
import Sparkles from '@effectweb/lucide/icons/sparkles'
import { Effect } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'
import {
  commandSlot,
  domBinding,
  modelOwner,
  view,
  type Snapshot,
  controllerView,
  available,
  resourceError,
  ownedTasks,
} from 'effectweb'
import type { ReaderDefaultAction } from './reader-position'
import { MarkdownContent } from './MarkdownContent'
import { readerAiAvailableEffect, runReaderAiEffect } from './reader-ai'
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
type Props = {
  selection: ReaderSelection
  defaultAction: ReaderDefaultAction
  aiDetail: ReaderAiDetail
  onTextChange: (text: string) => void
}
const taskSlot = commandSlot('reader-ai')
const capabilitySlot = commandSlot('reader-ai-capability')
const editableText = (element: HTMLDivElement, current: () => string) => {
  const update = () => {
    if (document.activeElement !== element && element.textContent !== current())
      element.textContent = current()
  }
  update()
  return { update, dispose: () => {} }
}
function menuController(props: Snapshot<Props>) {
  const owner = modelOwner<{
    props: Snapshot<Props>
    task: 'define' | 'translate' | null
    answer: AsyncResult.AsyncResult<string, unknown>
    enabled: boolean | undefined
  }>({ props, task: null, answer: AsyncResult.initial(), enabled: undefined })
  const actions = ownedTasks(owner, {
    run: {
      policy: 'replace',
      slot: taskSlot,
      result: 'answer',
      run: (task: 'define' | 'translate') => {
        const current = owner.read().props
        owner.patch({ task, answer: AsyncResult.initial() })
        return runReaderAiEffect({
          task,
          kind: current.selection.kind,
          text: current.selection.text,
          imageData: current.selection.imageData,
          detail: current.aiDetail,
        })
      },
    },
  })
  const run = actions.run
  let automaticKey = ''
  const automatic = () => {
    const current = owner.read()
    const key = `${current.props.selection.id}:${current.props.defaultAction}:${current.props.aiDetail}`
    if (!current.enabled || current.props.defaultAction === 'none' || key === automaticKey) return
    automaticKey = key
    run(current.props.defaultAction)
  }
  owner.run(
    capabilitySlot,
    readerAiAvailableEffect.pipe(
      Effect.tap((enabled) =>
        Effect.sync(() => {
          owner.patch({ enabled })
          automatic()
        }),
      ),
    ),
    'drop',
  )
  return {
    source: owner.source,
    actions,
    receive: (next: Snapshot<Props>) => {
      owner.patch({ props: next })
      automatic()
    },
    dispose: owner.dispose,
  }
}
export const ReaderSelectionMenu = controllerView({
  create: menuController,
  identity: (props) => props.selection.id,
  view: view((model) => {
    const props = model.props
    const { run } = model.actions
    const busy = model.answer.waiting
    const result = available(model.answer) ?? ''
    const error = resourceError(model.answer)
    const shouldRegenerate = (nextTask: 'define' | 'translate') =>
      Boolean(result) && model.task === nextTask
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
      run(nextTask)
    }
    const runActionFromKey = (event: KeyboardEvent, nextTask: 'define' | 'translate') => {
      if (event.key === 'Enter' || event.key === ' ') runAction(event, nextTask)
    }
    const style = () => ({
      left: `${Math.max(12, Math.min(props.selection.x, Number.POSITIVE_INFINITY))}px`,
      top: `${Math.max(12, Math.min(props.selection.y, Number.POSITIVE_INFINITY))}px`,
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
        {props.selection.kind === 'text' && props.selection.text.trim() ? (
          <div class='relative min-w-0 rounded-[7px] border border-[#444] bg-[#202020] focus-within:border-[#666]'>
            <div
              use={domBinding(props.selection.text, editableText)}
              class='reader-selection-preview box-border max-h-44 min-w-0 overflow-auto py-[7px] pr-[76px] pl-2 text-[0.86rem] leading-[1.35] whitespace-pre-wrap text-[#e8e8e8] outline-none [overflow-wrap:anywhere] [scrollbar-color:#555_#181818]'
              style={{ 'min-height': `calc(${previewRows()} * 1.35em + 14px)` }}
              role='textbox'
              aria-label='Selected text'
              aria-multiline='true'
              contenteditable
              spellcheck={false}
              onInput={(event) => props.onTextChange(event.currentTarget.textContent ?? '')}
              onPointerDown={(event) => event.stopPropagation()}
            />
            <div class='absolute top-1/2 right-1 flex -translate-y-1/2 gap-1'>
              <SelectionActionButton
                kind='translate'
                busy={busy && model.task === 'translate'}
                available={model.enabled}
                regenerate={shouldRegenerate('translate')}
                onPointerDown={runAction}
                onKeyDown={runActionFromKey}
              />
              <SelectionActionButton
                kind='define'
                busy={busy && model.task === 'define'}
                available={model.enabled}
                regenerate={shouldRegenerate('define')}
                onPointerDown={runAction}
                onKeyDown={runActionFromKey}
              />
            </div>
          </div>
        ) : null}
        {props.selection.kind === 'image' ? (
          <div class='flex justify-end gap-1'>
            <SelectionActionButton
              kind='translate'
              busy={busy && model.task === 'translate'}
              available={model.enabled}
              regenerate={shouldRegenerate('translate')}
              onPointerDown={runAction}
              onKeyDown={runActionFromKey}
            />
            <SelectionActionButton
              kind='define'
              busy={busy && model.task === 'define'}
              available={model.enabled}
              regenerate={shouldRegenerate('define')}
              onPointerDown={runAction}
              onKeyDown={runActionFromKey}
            />
          </div>
        ) : null}
        {busy ? (
          <div class='flex min-h-[34px] items-center gap-2 rounded-[7px] border border-[#444] bg-[#202020] px-[10px] text-[0.92rem] text-[#e8e8e8]'>
            <span class='h-2 w-2 animate-pulse rounded-full bg-current' />
            {model.task === 'translate' ? 'Translating...' : 'Defining...'}
          </div>
        ) : null}
        {error ? (
          <div
            role='alert'
            class='rounded-[7px] border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-300'
          >
            {error}
          </div>
        ) : null}
        {result ? (
          <div
            data-testid='reader-ai-result'
            data-reader-copyable
            class='reader-selection-result box-border min-h-0 w-0 min-w-full max-w-full max-h-[220px] cursor-text overflow-auto rounded-[7px] border border-[#444] bg-[#202020] px-[10px] py-[9px] text-[0.88rem] leading-[1.42] whitespace-pre-wrap text-[#e8e8e8] select-text [overflow-wrap:anywhere] [scrollbar-color:#555_#181818]'
          >
            {model.task === 'translate' && props.aiDetail === 'compact' ? (
              result
            ) : (
              <MarkdownContent content={result} />
            )}
          </div>
        ) : null}
      </div>
    )
  }),
})
const SelectionActionButton = view<{
  kind: 'define' | 'translate'
  busy: boolean
  available: boolean | undefined
  regenerate: boolean
  onPointerDown: (event: Event, task: 'define' | 'translate') => void
  onKeyDown: (event: KeyboardEvent, task: 'define' | 'translate') => void
}>((props) => {
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
      {props.regenerate ? (
        <RefreshCw class='size-4' />
      ) : props.kind === 'translate' ? (
        <Languages class='size-[17px]' />
      ) : (
        <Sparkles class='size-[17px]' />
      )}
    </button>
  )
})
