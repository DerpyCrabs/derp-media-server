import { createSignal, createUniqueId, untrack } from 'solid-js'
import X from 'lucide-solid/icons/x'
import type { FileItem } from '@/lib/files/types'
import type { HermesOpenTarget } from './hermes-open-target'
import { useModalFocus } from '@/lib/ui/modal-focus'
import { HermesChatPane } from './HermesChatPane'
import { canCloseHermesWindow, discardHermesDraft } from './hermes-session-store'

export function HermesChatDialog(props: {
  file: FileItem
  target: HermesOpenTarget
  onClose: () => void
}) {
  const initialTarget = untrack(() => props.target)
  const draftId = initialTarget.type === 'hermesDraft' ? crypto.randomUUID() : undefined
  const ownerId = `media-hermes-${initialTarget.sessionId ?? draftId}`
  const [sessionId, setSessionId] = createSignal(
    initialTarget.type === 'hermesSession' ? initialTarget.sessionId : undefined,
  )
  const [title, setTitle] = createSignal(untrack(() => props.file.name || 'Hermes session'))
  const titleId = createUniqueId()
  let dialogEl: HTMLDivElement | undefined
  let closing = false

  async function close() {
    if (closing) return
    closing = true
    const target = { draftId, sessionId: sessionId() }
    try {
      if (!(await canCloseHermesWindow(target))) return
      discardHermesDraft(target)
      props.onClose()
    } finally {
      closing = false
    }
  }

  const onKeyDown = useModalFocus({
    active: () => true,
    element: () => dialogEl,
    onEscape: () => void close(),
    ignoreEscape: () =>
      dialogEl?.querySelector('[data-modal-escape-scope], [aria-modal="true"]') !== null,
  })

  return (
    <div
      ref={(element) => {
        dialogEl = element
      }}
      class='fixed inset-0 z-70 flex flex-col bg-background'
      role='dialog'
      aria-modal='true'
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
    >
      <header class='flex h-12 shrink-0 items-center justify-between border-b border-border px-3'>
        <h2 id={titleId} class='truncate text-sm font-semibold'>
          {title()}
        </h2>
        <button
          type='button'
          aria-label='Close Hermes chat'
          class='inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted'
          onClick={() => void close()}
        >
          <X class='h-5 w-5' aria-hidden='true' />
        </button>
      </header>
      <div class='min-h-0 flex-1'>
        <HermesChatPane
          target={() => ({
            sessionId: sessionId(),
            draftId,
            cwd: initialTarget.type === 'hermesDraft' ? initialTarget.projectPath : undefined,
            readOnly: props.target.readOnly,
          })}
          ownerId={() => ownerId}
          title={title}
          contentVisible={() => true}
          active={() => true}
          onSessionCreated={setSessionId}
          onTitleChanged={setTitle}
        />
      </div>
    </div>
  )
}
