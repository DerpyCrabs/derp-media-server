import type { ExplorerActionDescriptor, ExplorerItem } from './types'
import { For, Show, createEffect, createSignal } from 'solid-js'

export type ExplorerActionDialogState<TPayload> = Readonly<{
  action: ExplorerActionDescriptor
  item?: ExplorerItem<TPayload>
}>

function actionOperation(action: ExplorerActionDescriptor): string {
  return action.operation
}

function isCreateFile(action: ExplorerActionDescriptor): boolean {
  return actionOperation(action) === 'createFile'
}

function isCreateFolder(action: ExplorerActionDescriptor): boolean {
  return actionOperation(action) === 'createFolder'
}

function dialogTitle(action: ExplorerActionDescriptor): string {
  if (action.form) return action.form.title
  if (isCreateFile(action)) return 'Create New File'
  if (isCreateFolder(action)) return action.label
  return action.label
}

function submitLabel(action: ExplorerActionDescriptor): string {
  if (action.form) return action.form.submitLabel
  if (isCreateFile(action) || isCreateFolder(action)) return 'Create'
  if (action.interaction === 'destination') {
    return actionOperation(action) === 'copy' ? 'Copy' : 'Move here'
  }
  return action.label
}

export function ExplorerActionDialog<TPayload>(props: {
  state: ExplorerActionDialogState<TPayload>
  defaultFileExtension?: string
  pending: boolean
  onCancel(): void
  onSubmit(input?: unknown): void
}) {
  const [value, setValue] = createSignal('')
  const [color, setColor] = createSignal('')
  const [primaryPath, setPrimaryPath] = createSignal('')
  const [additionalPaths, setAdditionalPaths] = createSignal('')

  createEffect(() => {
    const action = props.state.action
    setValue(
      action.form?.kind === 'choice'
        ? (action.form.choices[0]?.value ?? '')
        : action.form?.kind === 'appearance'
          ? 'Folder'
          : action.optimisticEffect === 'rename'
            ? (props.state.item?.resource.name ?? '')
            : '',
    )
    setColor('')
    setPrimaryPath('')
    setAdditionalPaths('')
  })

  const interaction = () => props.state.action.interaction ?? 'immediate'
  const existingName = () => {
    const candidate = value().trim().toLocaleLowerCase()
    return !!candidate && props.state.item?.resource.name.toLocaleLowerCase() === candidate
  }
  const requiresValue = () =>
    interaction() === 'name' || interaction() === 'destination' || interaction() === 'text'
  const valid = () => {
    const form = props.state.action.form
    if (props.pending) return false
    if (form?.kind === 'project') return !!value().trim() && !!primaryPath().trim()
    if (form?.kind === 'choice') return !!value().trim()
    return !requiresValue() || (!!value().trim() && !existingName())
  }

  function submit() {
    if (!valid()) return
    const action = props.state.action
    if (action.form?.kind === 'choice') {
      props.onSubmit({ name: value().trim() })
      return
    }
    if (action.form?.kind === 'project') {
      const primary = primaryPath().trim()
      const folders = [
        primary,
        ...additionalPaths()
          .split(/\r?\n/)
          .map((path) => path.trim())
          .filter(Boolean),
      ]
      props.onSubmit({ name: value().trim(), metadata: { primaryPath: primary, folders } })
      return
    }
    if (action.form?.kind === 'appearance') {
      props.onSubmit({ metadata: { icon: value().trim() || 'Folder', color: color().trim() } })
      return
    }
    if (interaction() === 'appearance') {
      props.onSubmit({ metadata: { icon: value().trim() || 'Folder', color: color().trim() } })
      return
    }
    if (interaction() === 'destination') {
      props.onSubmit({ destination: value().trim() })
      return
    }
    if (interaction() === 'name' || interaction() === 'text') {
      let name = value().trim()
      if (
        isCreateFile(action) &&
        props.defaultFileExtension &&
        !name.toLocaleLowerCase().endsWith(`.${props.defaultFileExtension.toLocaleLowerCase()}`)
      ) {
        name = `${name}.${props.defaultFileExtension}`
      }
      props.onSubmit({ name })
      return
    }
    props.onSubmit()
  }

  return (
    <div
      class='absolute inset-0 z-50 flex items-center justify-center bg-black/45 p-3'
      role='presentation'
      onClick={props.onCancel}
    >
      <div
        data-slot='dialog-content'
        class='w-full max-w-md rounded-lg border border-border bg-card p-4 shadow-xl'
        role={props.state.action.destructive ? 'alertdialog' : 'dialog'}
        aria-modal='true'
        aria-label={dialogTitle(props.state.action)}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 class='text-base font-semibold'>{dialogTitle(props.state.action)}</h2>
        <Show
          when={interaction() !== 'immediate'}
          fallback={
            <p class='mt-2 text-sm text-muted-foreground'>
              Confirm {props.state.action.label.toLocaleLowerCase()} for{' '}
              {props.state.item?.resource.name ?? 'this location'}.
            </p>
          }
        >
          <Show when={isCreateFile(props.state.action)}>
            <p class='mt-1 text-sm text-muted-foreground'>
              {props.defaultFileExtension
                ? `A .${props.defaultFileExtension} extension will be added if needed.`
                : 'Enter a file name.'}
            </p>
          </Show>
          <Show when={interaction() === 'destination'}>
            <p class='mt-1 text-sm text-muted-foreground'>Enter the destination folder.</p>
          </Show>
          <Show
            when={props.state.action.form?.kind === 'choice'}
            fallback={
              <input
                autofocus
                aria-label={
                  isCreateFolder(props.state.action)
                    ? 'Folder name'
                    : isCreateFile(props.state.action)
                      ? 'File name'
                      : interaction() === 'destination'
                        ? 'Destination folder'
                        : 'Name'
                }
                placeholder={
                  props.state.action.form?.kind === 'project'
                    ? 'Project name'
                    : isCreateFolder(props.state.action)
                      ? 'Folder name'
                      : isCreateFile(props.state.action)
                        ? 'File name (e.g. notes.md)'
                        : interaction() === 'destination'
                          ? 'Destination folder'
                          : interaction() === 'appearance'
                            ? 'Icon name'
                            : actionOperation(props.state.action) === 'rename'
                              ? 'New name'
                              : undefined
                }
                class='mt-3 h-9 w-full rounded-md border border-input bg-background px-3 text-sm'
                value={value()}
                onInput={(event) => setValue(event.currentTarget.value)}
                onKeyDown={(event) => event.key === 'Enter' && submit()}
              />
            }
          >
            <select
              autofocus
              class='mt-3 h-9 w-full rounded-md border border-input bg-background px-3 text-sm'
              value={value()}
              onChange={(event) => setValue(event.currentTarget.value)}
            >
              <For
                each={
                  props.state.action.form?.kind === 'choice' ? props.state.action.form.choices : []
                }
              >
                {(choice) => <option value={choice.value}>{choice.label}</option>}
              </For>
            </select>
          </Show>
          <Show when={props.state.action.form?.kind === 'project'}>
            <label class='mt-2 block space-y-1 text-xs text-muted-foreground'>
              <span>Primary directory</span>
              <input
                type='text'
                class='h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground'
                placeholder='/existing/gateway/path'
                value={primaryPath()}
                onInput={(event) => setPrimaryPath(event.currentTarget.value)}
              />
            </label>
            <details class='mt-2 rounded-md border border-border px-2.5 py-1.5 text-xs'>
              <summary class='cursor-pointer text-muted-foreground'>Additional directories</summary>
              <textarea
                class='mt-2 min-h-14 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground'
                placeholder='One gateway path per line'
                value={additionalPaths()}
                onInput={(event) => setAdditionalPaths(event.currentTarget.value)}
              />
            </details>
          </Show>
          <Show when={props.state.action.form?.kind === 'appearance'}>
            <div class='mt-3 flex flex-wrap gap-2'>
              <For
                each={
                  props.state.action.form?.kind === 'appearance'
                    ? props.state.action.form.icons
                    : []
                }
              >
                {(icon) => (
                  <button
                    type='button'
                    aria-label={icon}
                    title={icon}
                    class='h-8 rounded-md border border-input px-3 text-sm'
                    classList={{ 'bg-primary text-primary-foreground': value() === icon }}
                    onClick={() => setValue(icon)}
                  >
                    {icon}
                  </button>
                )}
              </For>
            </div>
            <input
              aria-label='Icon color'
              placeholder='Color (optional)'
              class='mt-2 h-9 w-full rounded-md border border-input bg-background px-3 text-sm'
              value={color()}
              onInput={(event) => setColor(event.currentTarget.value)}
            />
          </Show>
          <Show when={existingName()}>
            <p class='mt-2 text-sm text-amber-600'>The name is unchanged.</p>
          </Show>
        </Show>
        <div class='mt-4 flex justify-end gap-2'>
          <button
            type='button'
            class='h-8 rounded-md border border-input px-3 text-sm'
            onClick={props.onCancel}
          >
            Cancel
          </button>
          <button
            type='button'
            class={`h-8 rounded-md px-3 text-sm text-primary-foreground disabled:opacity-50 ${
              props.state.action.destructive ? 'bg-destructive' : 'bg-primary'
            }`}
            disabled={!valid()}
            onClick={submit}
          >
            {props.pending
              ? `${submitLabel(props.state.action)}…`
              : submitLabel(props.state.action)}
          </button>
        </div>
      </div>
    </div>
  )
}
