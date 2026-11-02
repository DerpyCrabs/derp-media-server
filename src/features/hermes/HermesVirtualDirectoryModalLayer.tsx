import { Disclosure } from '@/lib/ui/disclosure'
import { Input, Textarea } from '@/lib/ui/input'
import { Button } from '@/lib/ui/button'
import { Select } from '@/lib/ui/select'
import { gatewayDirectoriesSchema } from './hermes-api'
import { list, component, available, observe, resourceError, view } from 'effectweb'
import { queryCache } from '@/lib/api/cache'
import { apiSchemaEffect } from '@/lib/api/client'
import { cn } from '@/lib/ui/cn'
import { AVAILABLE_ICONS } from '@/lib/ui/available-icons'
import type { ModalOverlayScope } from '@/features/explorer/modal-overlay-scope'
import { Dialog } from '@/lib/ui/dialog'
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
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !props.model.pending) props.model.close()
        }}
        dismissible={!props.model.pending}
        title='Create Hermes project'
        class='sm:max-w-md max-h-[85dvh] overflow-y-auto'
      >
        <Input
          autofocus
          type='text'
          class={cn(
            'mt-4 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
            props.model.exists(draft().name) && 'border-yellow-500',
          )}
          placeholder='Project name'
          value={draft().name}
          disabled={props.model.pending}
          onInput={(event) => setDraft((state) => ({ ...state, name: event.currentTarget.value }))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
        />
        <label class='mt-3 block space-y-1 text-xs text-muted-foreground'>
          <span>Primary directory</span>
          <Input
            type='text'
            class='h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground'
            placeholder='/existing/gateway/path'
            value={draft().primaryPath}
            onInput={(event) =>
              setDraft((state) => ({ ...state, primaryPath: event.currentTarget.value }))
            }
          />
        </label>
        <Disclosure
          class='mt-2.5 rounded-md border border-border px-2.5 py-1.5 text-xs'
          triggerClass='cursor-pointer text-muted-foreground'
          trigger={<> Additional directories </>}
        >
          <Textarea
            class='mt-2 min-h-14 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground'
            placeholder='One gateway path per line'
            value={draft().additionalPaths}
            onInput={(event) =>
              setDraft((state) => ({ ...state, additionalPaths: event.currentTarget.value }))
            }
          />
        </Disclosure>
        <Disclosure
          class='mt-2.5 rounded-md border border-border px-2.5 py-1.5 text-xs'
          triggerClass='cursor-pointer text-muted-foreground'
          trigger={<> Browse gateway directories </>}
        >
          <div class='mt-2 space-y-2'>
            <div class='flex items-center justify-between gap-2'>
              <span class='truncate text-xs text-muted-foreground'>
                Gateway: {draft().gatewayPath || '(gateway cwd)'}
              </span>
              {draft().gatewayPath ? (
                <Button
                  variant='outline'
                  type='button'
                  class='h-7 rounded border border-input px-2 text-xs'
                  onClick={() =>
                    setDraft((state) => ({ ...state, primaryPath: state.gatewayPath }))
                  }
                >
                  Use current
                </Button>
              ) : null}
            </div>
            <GatewayDirectoryPicker
              path={draft().gatewayPath}
              choose={(path) => setDraft((state) => ({ ...state, primaryPath: path }))}
              browse={(path) => setDraft((state) => ({ ...state, gatewayPath: path }))}
            />
          </div>
        </Disclosure>
        {props.model.exists(draft().name) ? (
          <p class='mt-2 text-sm text-yellow-700 dark:text-yellow-300'>Project already exists</p>
        ) : null}
        {props.model.error ? (
          <p class='mt-2 text-sm text-destructive'>{props.model.error.message}</p>
        ) : null}
        <div class='mt-6 flex justify-end gap-2'>
          <Button
            variant='outline'
            type='button'
            class='h-9 rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent'
            disabled={props.model.pending}
            onClick={() => props.model.close()}
          >
            Cancel
          </Button>
          <Button
            variant='default'
            type='button'
            class='h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50'
            disabled={!canSubmit()}
            onClick={submit}
          >
            {props.model.pending ? 'Creating...' : 'Create'}
          </Button>
        </div>
      </Dialog>
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
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) props.model.setDetail(null)
          }}
          title={props.model.detail.file.name}
          class='sm:max-w-2xl max-h-[85dvh] overflow-y-auto'
        >
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
        </Dialog>
      ) : null}

      {props.model.action.dialog ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !props.model.action.pending) props.model.action.close()
          }}
          dismissible={!props.model.action.pending}
          title={
            props.model.action.dialog.action === 'moveToProject'
              ? 'Move to Hermes project'
              : props.model.action.dialog.action === 'addProjectFolder'
                ? 'Add gateway directory'
                : props.model.action.dialog.action === 'removeProjectFolder'
                  ? 'Remove gateway directory'
                  : props.model.action.dialog.action === 'setPrimaryFolder'
                    ? 'Set primary directory'
                    : 'Project appearance'
          }
        >
          {props.model.action.dialog.action === 'moveToProject' ? (
            <>
              <p class='mt-1 truncate text-xs text-muted-foreground'>
                {props.model.action.dialog.file.name} will use destination project cwd.
              </p>
              <Select
                aria-label='Project'
                class='min-w-0 w-full'
                value={actionValue() || props.model.action.projectChoices[0]?.name || ''}
                disabled={
                  props.model.action.projectChoicesLoading ||
                  !props.model.action.projectChoices.length
                }
                onValueChange={(value) => props.model.action.setValue(value)}
                options={props.model.action.projectChoices.map((project) => ({
                  value: project.name,
                  label: project.name,
                }))}
              />
              {!props.model.action.projectChoicesLoading &&
              !props.model.action.projectChoices.length ? (
                <p class='mt-2 text-xs text-muted-foreground'>No destination projects available.</p>
              ) : null}
            </>
          ) : null}
          {props.model.action.dialog.action === 'addProjectFolder' ? (
            <Input
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
              <Select
                aria-label='Project'
                class='min-w-0 w-full'
                value={actionValue()}
                onValueChange={(value) => props.model.action.setValue(value)}
                options={props.model.action
                  .projectFolders(props.model.action.dialog.entry)
                  .map((folder) => ({ value: folder, label: folder }))}
              />
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
                    <Button
                      size='icon'
                      variant='ghost'
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
                    </Button>
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
                  <Button
                    variant='outline'
                    type='button'
                    class='rounded border border-input px-2 py-1 text-foreground'
                    onClick={() => props.model.action.setAppearance({ color: '' })}
                  >
                    Default
                  </Button>
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
            <Button
              variant='outline'
              type='button'
              class='h-8 rounded-md border border-input px-3 text-sm'
              onClick={props.model.action.close}
            >
              Cancel
            </Button>
            <Button
              variant='default'
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
            </Button>
          </div>
        </Dialog>
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
                <Button
                  variant='ghost'
                  type='button'
                  class='block w-full truncate rounded px-2 py-1 justify-start text-left text-sm hover:bg-muted'
                  onDblClick={() => props.browse(entry.path)}
                  onClick={() => props.choose(entry.path)}
                >
                  {entry.name}
                </Button>
              ) : null,
          )}
        </div>
      </>
    )
  }),
)
