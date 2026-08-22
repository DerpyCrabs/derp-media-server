import { createSignal, For, Show } from 'solid-js'
import { cn } from '@/lib/ui/cn'
import { SOLID_AVAILABLE_ICONS } from '@/lib/ui/solid-available-icons'
import type { ModalOverlayScope } from '@/features/explorer/modal-overlay-scope'
import { modalDialogBackdropClass } from '@/features/explorer/modal-overlay-scope'
import type { HermesVirtualDirectoryModal } from './use-hermes-virtual-directory'

function HermesCreateProjectDialog(props: {
  model: HermesVirtualDirectoryModal['createProject']
  overlayScope?: ModalOverlayScope
}) {
  const [projectName, setProjectName] = createSignal('')
  const canSubmit = () =>
    !!projectName().trim() &&
    !!props.model.primaryPath().trim() &&
    !props.model.exists(projectName()) &&
    !props.model.pending()
  const submit = () => {
    if (canSubmit()) props.model.submit(projectName())
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
            props.model.exists(projectName()) && 'border-yellow-500',
          )}
          placeholder='Project name'
          value={projectName()}
          disabled={props.model.pending()}
          onInput={(event) => setProjectName(event.currentTarget.value)}
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
            value={props.model.primaryPath()}
            onInput={(event) => props.model.setPrimaryPath(event.currentTarget.value)}
          />
        </label>
        <details class='mt-2.5 rounded-md border border-border px-2.5 py-1.5 text-xs'>
          <summary class='cursor-pointer text-muted-foreground'>Additional directories</summary>
          <textarea
            class='mt-2 min-h-14 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground'
            placeholder='One gateway path per line'
            value={props.model.additionalPaths()}
            onInput={(event) => props.model.setAdditionalPaths(event.currentTarget.value)}
          />
        </details>
        <details class='mt-2.5 rounded-md border border-border px-2.5 py-1.5 text-xs'>
          <summary class='cursor-pointer text-muted-foreground'>Browse gateway directories</summary>
          <div class='mt-2 space-y-2'>
            <div class='flex items-center justify-between gap-2'>
              <span class='truncate text-xs text-muted-foreground'>
                Gateway: {props.model.gatewayPath() || '(gateway cwd)'}
              </span>
              <Show when={props.model.gatewayPath()}>
                <button
                  type='button'
                  class='h-7 rounded border border-input px-2 text-xs'
                  onClick={() => props.model.setPrimaryPath(props.model.gatewayPath())}
                >
                  Use current
                </button>
              </Show>
            </div>
            <Show when={props.model.gatewayError()}>
              {(error) => <p class='text-xs text-destructive'>{error()}</p>}
            </Show>
            <div class='max-h-28 overflow-auto'>
              <For each={props.model.gatewayEntries()}>
                {(entry) => (
                  <Show when={entry.isDirectory}>
                    <button
                      type='button'
                      class='block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-muted'
                      onDblClick={() => props.model.setGatewayPath(entry.path)}
                      onClick={() => props.model.setPrimaryPath(entry.path)}
                    >
                      {entry.name}
                    </button>
                  </Show>
                )}
              </For>
            </div>
          </div>
        </details>
        <Show when={props.model.exists(projectName())}>
          <p class='mt-2 text-sm text-yellow-700 dark:text-yellow-300'>Project already exists</p>
        </Show>
        <Show when={props.model.error()}>
          {(error) => <p class='mt-2 text-sm text-destructive'>{error()?.message}</p>}
        </Show>
        <div class='mt-6 flex justify-end gap-2'>
          <button
            type='button'
            class='h-9 rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent'
            disabled={props.model.pending()}
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
            {props.model.pending() ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function HermesVirtualDirectoryModalLayer(props: {
  model: HermesVirtualDirectoryModal
  overlayScope?: ModalOverlayScope
}) {
  return (
    <>
      <Show when={props.model.createProject.open()}>
        <HermesCreateProjectDialog
          model={props.model.createProject}
          overlayScope={props.overlayScope}
        />
      </Show>
      <Show when={props.model.detail()}>
        {(getDetail) => (
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
                  <h2 class='text-lg font-semibold'>{getDetail().file.name}</h2>
                  <p class='text-xs text-muted-foreground'>
                    {getDetail().entry.archived
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
              <Show when={getDetail().entry.kind === 'draft'}>
                <p class='mt-5 text-sm text-muted-foreground'>Untouched draft.</p>
              </Show>
              <Show when={props.model.detailQuery.isPending}>
                <p class='mt-5 text-sm text-muted-foreground'>Loading transcript…</p>
              </Show>
              <Show when={props.model.detailQuery.isError}>
                <p class='mt-5 text-sm text-destructive'>
                  {(props.model.detailQuery.error as Error)?.message}
                </p>
              </Show>
              <Show when={props.model.detailQuery.data}>
                {(data) => (
                  <pre class='mt-5 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs'>
                    {JSON.stringify(data().messages, null, 2)}
                  </pre>
                )}
              </Show>
            </div>
          </div>
        )}
      </Show>

      <Show when={props.model.actionDialog()}>
        {(dialog) => (
          <div
            data-no-window-drag
            class={modalDialogBackdropClass(props.overlayScope)}
            role='presentation'
            onClick={() => props.model.setActionDialog(null)}
          >
            <div
              role='dialog'
              aria-modal='true'
              aria-labelledby='hermes-virtual-action-title'
              class='w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-lg'
              onClick={(event) => event.stopPropagation()}
            >
              <h2 id='hermes-virtual-action-title' class='text-base font-semibold'>
                {dialog().action === 'moveToProject'
                  ? 'Move to Hermes project'
                  : dialog().action === 'addProjectFolder'
                    ? 'Add gateway directory'
                    : dialog().action === 'removeProjectFolder'
                      ? 'Remove gateway directory'
                      : dialog().action === 'setPrimaryFolder'
                        ? 'Set primary directory'
                        : 'Project appearance'}
              </h2>
              <Show when={dialog().action === 'moveToProject'}>
                <p class='mt-1 truncate text-xs text-muted-foreground'>
                  {dialog().file.name} will use destination project cwd.
                </p>
                <select
                  class='mt-3 h-9 w-full rounded-md border border-input bg-background px-2 text-sm'
                  value={props.model.actionValue() || props.model.projectChoices()[0]?.name || ''}
                  disabled={
                    props.model.projectChoicesLoading() || !props.model.projectChoices().length
                  }
                  onChange={(event) => props.model.setActionValue(event.currentTarget.value)}
                >
                  <For each={props.model.projectChoices()}>
                    {(project) => <option value={project.name}>{project.name}</option>}
                  </For>
                </select>
                <Show
                  when={
                    !props.model.projectChoicesLoading() && !props.model.projectChoices().length
                  }
                >
                  <p class='mt-2 text-xs text-muted-foreground'>
                    No destination projects available.
                  </p>
                </Show>
              </Show>
              <Show when={dialog().action === 'addProjectFolder'}>
                <input
                  autofocus
                  class='mt-3 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm'
                  placeholder='Existing gateway directory path'
                  value={props.model.actionValue()}
                  onInput={(event) => props.model.setActionValue(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') props.model.submitActionDialog()
                  }}
                />
              </Show>
              <Show
                when={
                  dialog().action === 'removeProjectFolder' ||
                  dialog().action === 'setPrimaryFolder'
                }
              >
                <select
                  class='mt-3 h-9 w-full rounded-md border border-input bg-background px-2 text-sm'
                  value={props.model.actionValue()}
                  onChange={(event) => props.model.setActionValue(event.currentTarget.value)}
                >
                  <For each={props.model.projectFolders(dialog().entry)}>
                    {(folder) => <option value={folder}>{folder}</option>}
                  </For>
                </select>
                <Show when={!props.model.projectFolders(dialog().entry).length}>
                  <p class='mt-2 text-xs text-muted-foreground'>
                    Project has no gateway directories.
                  </p>
                </Show>
              </Show>
              <Show when={dialog().action === 'setAppearance'}>
                <div class='mt-3 grid max-h-36 grid-cols-8 gap-1 overflow-y-auto'>
                  <For each={SOLID_AVAILABLE_ICONS}>
                    {(item) => (
                      <button
                        type='button'
                        title={item.name}
                        aria-label={item.name}
                        class={cn(
                          'flex h-8 w-8 items-center justify-center rounded-md border',
                          props.model.appearanceIcon() === item.name
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-transparent text-muted-foreground hover:bg-muted',
                        )}
                        onClick={() => props.model.setAppearanceIcon(item.name)}
                      >
                        <item.Icon class='h-4 w-4' />
                      </button>
                    )}
                  </For>
                </div>
                <label class='mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground'>
                  <span>Accent color</span>
                  <span class='flex items-center gap-2'>
                    <input
                      type='color'
                      aria-label='Project accent color'
                      class='h-8 w-10 cursor-pointer rounded border border-input bg-background p-1'
                      value={props.model.appearanceColor() || '#8b5cf6'}
                      onInput={(event) => props.model.setAppearanceColor(event.currentTarget.value)}
                    />
                    <button
                      type='button'
                      class='rounded border border-input px-2 py-1 text-foreground'
                      onClick={() => props.model.setAppearanceColor('')}
                    >
                      Default
                    </button>
                  </span>
                </label>
              </Show>
              <Show when={props.model.mutation.isError}>
                <p class='mt-2 text-xs text-destructive'>
                  {(props.model.mutation.error as Error)?.message ?? 'Hermes action failed'}
                </p>
              </Show>
              <div class='mt-4 flex justify-end gap-2'>
                <button
                  type='button'
                  class='h-8 rounded-md border border-input px-3 text-sm'
                  onClick={() => props.model.setActionDialog(null)}
                >
                  Cancel
                </button>
                <button
                  type='button'
                  class='h-8 rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50'
                  disabled={
                    props.model.mutation.isPending ||
                    (dialog().action !== 'setAppearance' &&
                      dialog().action !== 'moveToProject' &&
                      !props.model.actionValue().trim()) ||
                    (dialog().action === 'moveToProject' && !props.model.projectChoices().length)
                  }
                  onClick={props.model.submitActionDialog}
                >
                  {props.model.mutation.isPending
                    ? 'Saving…'
                    : dialog().action === 'moveToProject'
                      ? 'Move'
                      : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </Show>
    </>
  )
}
