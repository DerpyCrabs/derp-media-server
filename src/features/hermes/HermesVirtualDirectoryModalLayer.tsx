import { gatewayDirectoriesSchema } from './hermes-api'
import { list, component, available, observe, resourceError, view } from 'effectweb'
import { queryCache } from '@/lib/api/cache'
import { apiSchemaEffect } from '@/lib/api/client'
import { cn } from '@/lib/ui/cn'
import { AVAILABLE_ICONS } from '@/lib/ui/available-icons'
import type { ModalOverlayScope } from '@/features/explorer/modal-overlay-scope'
import { modalDialogBackdropClass } from '@/features/explorer/modal-overlay-scope'
import type { HermesVirtualDirectoryModal } from './hermes-virtual-directory'
import { query, querySource } from '@effectweb/query'
const HermesCreateProjectDialog = component(
  {
    init: (_props: {
      model: HermesVirtualDirectoryModal['createProject']
      overlayScope?: ModalOverlayScope
    }) => ({ draft: { name: '', primaryPath: '', additionalPaths: '', gatewayPath: '' } }),
  },
  view((local, patch) => {
    const props = local.props
    const draft = () => local.draft,
      setDraft = (
        value: typeof local.draft | ((state: typeof local.draft) => typeof local.draft),
      ) => patch({ draft: typeof value === 'function' ? value(local.draft) : value })
    const canSubmit = () =>
      !!draft().name.trim() &&
      !!draft().primaryPath.trim() &&
      !props.model.exists(draft().name) &&
      !props.model.pending
    const submit = () => {
      const value = draft()
      if (canSubmit())
        props.model.submit({
          name: value.name,
          primaryPath: value.primaryPath,
          additionalPaths: value.additionalPaths.split(/\r?\n/),
        })
    }
    return (
      <div
        data-no-window-drag
        class={modalDialogBackdropClass(props.overlayScope)}
        role='presentation'
        onClick={() => props.model.close()}
      >
        <div
          role='dialog'
          aria-modal='true'
          aria-labelledby='create-hermes-project-title'
          class='max-h-[calc(100%-1rem)] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg'
          onClick={(event) => event.stopPropagation()}
        >
          <h2 id='create-hermes-project-title' class='text-lg font-semibold'>
            Create Hermes project
          </h2>
          <p class='mt-1 text-sm text-muted-foreground'>
            Enter the project name and its directories.
          </p>
          <input
            autofocus
            type='text'
            class={cn(
              'mt-4 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
              props.model.exists(draft().name) && 'border-yellow-500',
            )}
            placeholder='Project name'
            value={draft().name}
            disabled={props.model.pending}
            onInput={(event) =>
              setDraft((state) => ({ ...state, name: event.currentTarget.value }))
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit()
            }}
          />
          <label class='mt-3 block space-y-1 text-xs text-muted-foreground'>
            <span>Primary directory</span>
            <input
              type='text'
              class='h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground'
              placeholder='/existing/gateway/path'
              value={draft().primaryPath}
              onInput={(event) =>
                setDraft((state) => ({ ...state, primaryPath: event.currentTarget.value }))
              }
            />
          </label>
          <details class='mt-2.5 rounded-md border border-border px-2.5 py-1.5 text-xs'>
            <summary class='cursor-pointer text-muted-foreground'>Additional directories</summary>
            <textarea
              class='mt-2 min-h-14 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground'
              placeholder='One gateway path per line'
              value={draft().additionalPaths}
              onInput={(event) =>
                setDraft((state) => ({ ...state, additionalPaths: event.currentTarget.value }))
              }
            />
          </details>
          <details class='mt-2.5 rounded-md border border-border px-2.5 py-1.5 text-xs'>
            <summary class='cursor-pointer text-muted-foreground'>
              Browse gateway directories
            </summary>
            <div class='mt-2 space-y-2'>
              <div class='flex items-center justify-between gap-2'>
                <span class='truncate text-xs text-muted-foreground'>
                  Gateway: {draft().gatewayPath || '(gateway cwd)'}
                </span>
                {draft().gatewayPath ? (
                  <button
                    type='button'
                    class='h-7 rounded border border-input px-2 text-xs'
                    onClick={() =>
                      setDraft((state) => ({ ...state, primaryPath: state.gatewayPath }))
                    }
                  >
                    Use current
                  </button>
                ) : null}
              </div>
              <GatewayDirectoryPicker
                path={draft().gatewayPath}
                choose={(path) => setDraft((state) => ({ ...state, primaryPath: path }))}
                browse={(path) => setDraft((state) => ({ ...state, gatewayPath: path }))}
              />
            </div>
          </details>
          {props.model.exists(draft().name) ? (
            <p class='mt-2 text-sm text-yellow-700 dark:text-yellow-300'>Project already exists</p>
          ) : null}
          {props.model.error ? (
            <p class='mt-2 text-sm text-destructive'>{props.model.error.message}</p>
          ) : null}
          <div class='mt-6 flex justify-end gap-2'>
            <button
              type='button'
              class='h-9 rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent'
              disabled={props.model.pending}
              onClick={() => props.model.close()}
            >
              Cancel
            </button>
            <button
              type='button'
              class='h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50'
              disabled={!canSubmit()}
              onClick={submit}
            >
              {props.model.pending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    )
  }),
)
export const HermesVirtualDirectoryModalLayer = view<{
  model: HermesVirtualDirectoryModal
  overlayScope?: ModalOverlayScope
}>((props) => {
  const actionValue = () => {
    const dialog = props.model.action.dialog
    return dialog && dialog.action !== 'setAppearance' ? dialog.value : ''
  }
  const appearance = () => {
    const dialog = props.model.action.dialog
    return dialog?.action === 'setAppearance' ? dialog.appearance : { icon: 'Folder', color: '' }
  }
  return (
    <>
      {props.model.createProject.open ? (
        <HermesCreateProjectDialog
          model={props.model.createProject}
          overlayScope={props.overlayScope}
        />
      ) : null}
      {props.model.detail ? (
        <div
          data-no-window-drag
          class={modalDialogBackdropClass(props.overlayScope)}
          role='presentation'
          onClick={() => props.model.setDetail(null)}
        >
          <div
            role='dialog'
            aria-modal='true'
            class='max-h-[85%] w-full max-w-2xl overflow-auto rounded-lg border border-border bg-card p-5 text-card-foreground shadow-xl'
            onClick={(event) => event.stopPropagation()}
          >
            <div class='flex items-start justify-between gap-3'>
              <div>
                <h2 class='text-lg font-semibold'>{props.model.detail.file.name}</h2>
                <p class='text-xs text-muted-foreground'>
                  {props.model.detail.entry.archived
                    ? 'Archived · read-only'
                    : 'Read-only session detail'}
                </p>
              </div>
              <button
                type='button'
                class='rounded border border-input px-3 py-1 text-sm'
                onClick={() => props.model.setDetail(null)}
              >
                Close
              </button>
            </div>
            {props.model.detail.entry.kind === 'draft' ? (
              <p class='mt-5 text-sm text-muted-foreground'>Untouched draft.</p>
            ) : null}
            {props.model.detailResult.waiting ? (
              <p class='mt-5 text-sm text-muted-foreground'>Loading transcript…</p>
            ) : null}
            {resourceError(props.model.detailResult) ? (
              <p class='mt-5 text-sm text-destructive'>{resourceError(props.model.detailResult)}</p>
            ) : null}
            {((data) =>
              data ? (
                <pre class='mt-5 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs'>
                  {JSON.stringify(data.messages, null, 2)}
                </pre>
              ) : null)(available(props.model.detailResult))}
          </div>
        </div>
      ) : null}

      {props.model.action.dialog ? (
        <div
          data-no-window-drag
          class={modalDialogBackdropClass(props.overlayScope)}
          role='presentation'
          onClick={props.model.action.close}
        >
          <div
            role='dialog'
            aria-modal='true'
            aria-labelledby='hermes-virtual-action-title'
            class='w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-lg'
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id='hermes-virtual-action-title' class='text-base font-semibold'>
              {props.model.action.dialog.action === 'moveToProject'
                ? 'Move to Hermes project'
                : props.model.action.dialog.action === 'addProjectFolder'
                  ? 'Add gateway directory'
                  : props.model.action.dialog.action === 'removeProjectFolder'
                    ? 'Remove gateway directory'
                    : props.model.action.dialog.action === 'setPrimaryFolder'
                      ? 'Set primary directory'
                      : 'Project appearance'}
            </h2>
            {props.model.action.dialog.action === 'moveToProject' ? (
              <>
                <p class='mt-1 truncate text-xs text-muted-foreground'>
                  {props.model.action.dialog.file.name} will use destination project cwd.
                </p>
                <select
                  class='mt-3 h-9 w-full rounded-md border border-input bg-background px-2 text-sm'
                  value={actionValue() || props.model.action.projectChoices[0]?.name || ''}
                  disabled={
                    props.model.action.projectChoicesLoading ||
                    !props.model.action.projectChoices.length
                  }
                  onChange={(event) => props.model.action.setValue(event.currentTarget.value)}
                >
                  {list(
                    props.model.action.projectChoices ?? [],
                    (project) => project.path,
                    (project) => (
                      <option value={project.name}>{project.name}</option>
                    ),
                  )}
                </select>
                {!props.model.action.projectChoicesLoading &&
                !props.model.action.projectChoices.length ? (
                  <p class='mt-2 text-xs text-muted-foreground'>
                    No destination projects available.
                  </p>
                ) : null}
              </>
            ) : null}
            {props.model.action.dialog.action === 'addProjectFolder' ? (
              <input
                autofocus
                class='mt-3 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm'
                placeholder='Existing gateway directory path'
                value={actionValue()}
                onInput={(event) => props.model.action.setValue(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') props.model.action.submit()
                }}
              />
            ) : null}
            {props.model.action.dialog.action === 'removeProjectFolder' ||
            props.model.action.dialog.action === 'setPrimaryFolder' ? (
              <>
                <select
                  class='mt-3 h-9 w-full rounded-md border border-input bg-background px-2 text-sm'
                  value={actionValue()}
                  onChange={(event) => props.model.action.setValue(event.currentTarget.value)}
                >
                  {list(
                    props.model.action.projectFolders(props.model.action.dialog.entry) ?? [],
                    (folder) => folder,
                    (folder) => (
                      <option value={folder}>{folder}</option>
                    ),
                  )}
                </select>
                {!props.model.action.projectFolders(props.model.action.dialog.entry).length ? (
                  <p class='mt-2 text-xs text-muted-foreground'>
                    Project has no gateway directories.
                  </p>
                ) : null}
              </>
            ) : null}
            {props.model.action.dialog.action === 'setAppearance' ? (
              <>
                <div class='mt-3 grid max-h-36 grid-cols-8 gap-1 overflow-y-auto'>
                  {list(
                    AVAILABLE_ICONS ?? [],
                    (item) => item.name,
                    (item) => (
                      <button
                        type='button'
                        title={item.name}
                        aria-label={item.name}
                        class={cn(
                          'flex h-8 w-8 items-center justify-center rounded-md border',
                          appearance().icon === item.name
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-transparent text-muted-foreground hover:bg-muted',
                        )}
                        onClick={() => props.model.action.setAppearance({ icon: item.name })}
                      >
                        <item.Icon class='h-4 w-4' />
                      </button>
                    ),
                  )}
                </div>
                <label class='mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground'>
                  <span>Accent color</span>
                  <span class='flex items-center gap-2'>
                    <input
                      type='color'
                      aria-label='Project accent color'
                      class='h-8 w-10 cursor-pointer rounded border border-input bg-background p-1'
                      value={appearance().color || '#8b5cf6'}
                      onInput={(event) =>
                        props.model.action.setAppearance({ color: event.currentTarget.value })
                      }
                    />
                    <button
                      type='button'
                      class='rounded border border-input px-2 py-1 text-foreground'
                      onClick={() => props.model.action.setAppearance({ color: '' })}
                    >
                      Default
                    </button>
                  </span>
                </label>
              </>
            ) : null}
            {props.model.action.error ? (
              <p class='mt-2 text-xs text-destructive'>
                {props.model.action.error?.message ?? 'Hermes action failed'}
              </p>
            ) : null}
            <div class='mt-4 flex justify-end gap-2'>
              <button
                type='button'
                class='h-8 rounded-md border border-input px-3 text-sm'
                onClick={props.model.action.close}
              >
                Cancel
              </button>
              <button
                type='button'
                class='h-8 rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50'
                disabled={
                  props.model.action.pending ||
                  (props.model.action.dialog.action !== 'setAppearance' &&
                    props.model.action.dialog.action !== 'moveToProject' &&
                    !actionValue().trim()) ||
                  (props.model.action.dialog.action === 'moveToProject' &&
                    !props.model.action.projectChoices.length)
                }
                onClick={props.model.action.submit}
              >
                {props.model.action.pending
                  ? 'Saving…'
                  : props.model.action.dialog.action === 'moveToProject'
                    ? 'Move'
                    : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
})
const gatewayQuery = query({
  name: 'gateway-directories',
  load: (path: string) =>
    apiSchemaEffect(
      gatewayDirectoriesSchema,
      `/api/virtual-directory/fs?path=${encodeURIComponent(path)}`,
    ),
})
const GatewayDirectoryPicker = view<{
  path: string
  choose: (path: string) => void
  browse: (path: string) => void
}>((props) =>
  observe(querySource(queryCache, gatewayQuery, props.path), (result) => {
    const data = available(result)
    return (
      <>
        <p class='text-xs text-destructive'>{data?.error || resourceError(result)}</p>
        <div class='max-h-28 overflow-auto'>
          {list(
            data?.entries ?? [],
            (entry) => entry.path,
            (entry) =>
              entry.isDirectory ? (
                <button
                  type='button'
                  class='block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-muted'
                  onDblClick={() => props.browse(entry.path)}
                  onClick={() => props.choose(entry.path)}
                >
                  {entry.name}
                </button>
              ) : null,
          )}
        </div>
      </>
    )
  }),
)
