import { randomId } from '@/lib/random-id'
import { view, type Snapshot, component, ownerOf } from 'effectweb'
import { Effect } from 'effect'
import X from '@effectweb/lucide/icons/x'
import type { FileItem } from '@/lib/files/types'
import type { HermesOpenTarget } from './hermes-open-target'
import { modalFocus } from '@/lib/ui/modal-focus'
import { HermesChatPane } from './LazyHermesChatPane'
import { HermesSessions } from './hermes-session-store'

type Props = { file: FileItem; target: HermesOpenTarget; onClose: () => void }

export const HermesChatDialog = component(
  {
    init: (props: Snapshot<Props>) => {
      const initialTarget = props.target
      const draftId = initialTarget.type === 'hermesDraft' ? randomId() : undefined
      return {
        initialTarget,
        draftId,
        ownerId: `media-hermes-${initialTarget.sessionId ?? draftId}`,
        sessionId: initialTarget.type === 'hermesSession' ? initialTarget.sessionId : undefined,
        title: props.file.name || 'Hermes session',
        titleId: randomId(),
      }
    },
    identity: (props) => props.file.path,
  },
  view((model, patch) => {
    const close = () => {
      const target = { draftId: model.draftId, sessionId: model.sessionId }
      ownerOf(patch).run(
        'close',
        HermesSessions.canClose(target).pipe(
          Effect.tap((allowed) =>
            Effect.sync(() => {
              if (allowed) {
                HermesSessions.discardDraft(target)
                model.props.onClose()
              }
            }),
          ),
        ),
        'drop',
      )
    }
    return (
      <div
        use={modalFocus({
          onEscape: close,
          ignoreEscape: (event) =>
            (event.currentTarget as HTMLElement).querySelector(
              '[data-modal-escape-scope], [aria-modal="true"]',
            ) !== null,
        })}
        class='fixed inset-0 z-70 flex flex-col bg-background'
        role='dialog'
        aria-modal='true'
        aria-labelledby={model.titleId}
      >
        <header class='flex h-12 shrink-0 items-center justify-between border-b border-border px-3'>
          <h2 id={model.titleId} class='truncate text-sm font-semibold'>
            {model.title}
          </h2>
          <button
            type='button'
            aria-label='Close Hermes chat'
            class='inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted'
            onClick={close}
          >
            <X class='h-5 w-5' aria-hidden='true' />
          </button>
        </header>
        <div class='min-h-0 flex-1'>
          <HermesChatPane
            target={{
              sessionId: model.sessionId,
              draftId: model.draftId,
              cwd:
                model.initialTarget.type === 'hermesDraft'
                  ? model.initialTarget.projectPath
                  : undefined,
              readOnly: model.props.target.readOnly,
            }}
            ownerId={model.ownerId}
            title={model.title}
            contentVisible
            active
            onSessionCreated={(sessionId) => patch({ sessionId })}
            onTitleChanged={(title) => patch({ title })}
          />
        </div>
      </div>
    )
  }),
)
