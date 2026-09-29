import { createEffect, createMemo, createSignal, For, Show, type Accessor } from 'solid-js'
import ChevronDown from 'lucide-solid/icons/chevron-down'
import Check from 'lucide-solid/icons/check'
import { FloatingContextMenu } from '@/features/explorer/FloatingContextMenu'
import type { FileBrowserHost } from '@/features/explorer/FileBrowser'
import type { FileItem } from '@/lib/files/types'
import { showAppConfirm } from '@/lib/ui/app-dialog'
import type { DesktopBridge, PickerRequest } from './bridge'

function globMatches(name: string, pattern: string) {
  let source = ''
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!
    if (char === '*') source += '.*'
    else if (char === '?') source += '.'
    else if (char === '[' && pattern.indexOf(']', i + 1) > i + 1) {
      const end = pattern.indexOf(']', i + 1)
      source += pattern.slice(i, end + 1).replace(/^\[!/, '[^')
      i = end
    } else source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  try {
    return new RegExp(`^${source}$`).test(name)
  } catch {
    return name === pattern
  }
}

export function createPicker(options: {
  request: Accessor<PickerRequest | undefined>
  directory: Accessor<string>
  navigate: (path: string) => void
  bridge: DesktopBridge | undefined
}) {
  const [selected, setSelected] = createSignal<FileItem[]>([])
  const [anchor, setAnchor] = createSignal('')
  const [name, setName] = createSignal('')
  const [filter, setFilter] = createSignal(0)
  const [choices, setChoices] = createSignal<Record<string, string>>({})
  const [pending, setPending] = createSignal(false)
  const [error, setError] = createSignal('')
  createEffect(options.request, (request) => {
    if (!request) return
    setName(request.name)
    setFilter(request.filter)
    setChoices(
      Object.fromEntries(
        request.choices.map((choice) => [
          choice.id,
          choice.selected || (choice.options[0]?.id ?? 'false'),
        ]),
      ),
    )
  })
  createEffect(
    () => [options.directory(), filter()],
    () => {
      setSelected([])
      setAnchor('')
      setError('')
    },
  )
  const eligible = (file: FileItem) =>
    !file.isVirtual && file.isDirectory === !!options.request()?.directory
  const visible = (file: FileItem) => {
    if (!options.request() || file.isDirectory) return true
    if (options.request()?.directory) return false
    const rules = options.request()?.filters[filter()]?.rules
    return (
      !rules?.length ||
      rules.some((rule) => rule.patterns.some((pattern) => globMatches(file.name, pattern)))
    )
  }
  async function accept(files = selected()) {
    const request = options.request()
    if (!request || pending() || !options.bridge?.pick) return
    if (!request.directory && files.length === 1 && files[0]!.isDirectory) {
      options.navigate(files[0]!.path)
      return
    }
    const destination =
      request.mode === 'SaveFiles' && files[0]?.isDirectory ? files[0].path : options.directory()
    const paths = files.filter(eligible).map((file) => file.path)
    if (request.directory && !paths.length) paths.push(options.directory())
    if (request.mode === 'OpenFile' && !paths.length) return
    if (request.mode === 'SaveFile' && !name().trim()) return
    setPending(true)
    setError('')
    try {
      const selection = {
        paths,
        directory: destination,
        name: name(),
        filter: filter(),
        choices: choices(),
      }
      const result = await options.bridge.pick(selection)
      if (
        result.overwrite?.length &&
        (await showAppConfirm({
          title: 'Replace file?',
          message: `${name()} already exists. Replace it?`,
          confirmLabel: 'Replace',
          destructive: true,
        }))
      ) {
        await options.bridge.pick({ ...selection, overwrite: true })
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }
  const selection: NonNullable<FileBrowserHost['selection']> = {
    includes: (file) => selected().some((item) => item.path === file.path),
    visible,
    click(file, event, ordered) {
      if (!options.request()) return
      if (options.request()?.mode === 'SaveFile' && !file.isDirectory) setName(file.name)
      if (event?.shiftKey && options.request()?.multiple && anchor()) {
        const from = ordered.findIndex((item) => item.path === anchor())
        const to = ordered.findIndex((item) => item.path === file.path)
        if (from >= 0 && to >= 0)
          setSelected(ordered.slice(Math.min(from, to), Math.max(from, to) + 1).filter(eligible))
      } else if (
        (event?.ctrlKey || event?.metaKey) &&
        options.request()?.multiple &&
        eligible(file)
      ) {
        setSelected((previous) =>
          previous.some((item) => item.path === file.path)
            ? previous.filter((item) => item.path !== file.path)
            : [...previous, file],
        )
        setAnchor(file.path)
      } else {
        setSelected([file])
        setAnchor(file.path)
      }
    },
    activate(file) {
      if (file.isDirectory) options.navigate(file.path)
      else if (eligible(file)) {
        if (options.request()?.mode === 'SaveFile') setName(file.name)
        void accept([file])
      }
    },
    keyDown(event, ordered) {
      if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        const current = (event.target as HTMLElement).closest<HTMLElement>('[data-file-path]')
          ?.dataset.filePath
        const index = ordered.findIndex((file) => file.path === current)
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? ordered.length - 1
              : Math.max(
                  0,
                  Math.min(
                    ordered.length - 1,
                    index + (['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1),
                  ),
                )
        const file = ordered[next]
        if (file) {
          selection.click(file, event, ordered)
          document
            .querySelector<HTMLElement>(`[data-file-path="${CSS.escape(file.path)}"]`)
            ?.focus()
        }
      }
      if (event.key === 'Enter' && selected().length > 1) {
        event.preventDefault()
        void accept()
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'c' &&
        selected().length
      ) {
        event.preventDefault()
        void options.bridge
          ?.copy(selected().map((file) => file.path))
          .catch((cause: unknown) => setError(String(cause)))
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'a' &&
        options.request()?.multiple
      ) {
        event.preventDefault()
        setSelected(ordered.filter(eligible))
      }
    },
  }
  return {
    selected,
    name,
    setName,
    filter,
    setFilter,
    choices,
    setChoices,
    pending,
    error,
    accept,
    selection,
  }
}

type Picker = ReturnType<typeof createPicker>

function PickerChoice(props: {
  label: string
  value: string
  options: { id: string; label: string }[]
  onChange: (value: string) => void
}) {
  const [open, setOpen] = createSignal(false)
  const [anchor, setAnchor] = createSignal<HTMLDivElement | null>(null)
  return (
    <div class='relative' ref={setAnchor}>
      <button
        type='button'
        aria-label={props.label}
        aria-expanded={open() ? 'true' : 'false'}
        onClick={() => setOpen(!open())}
        class='inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent'
      >
        <span>{props.options.find((item) => item.id === props.value)?.label ?? props.label}</span>
        <ChevronDown class='size-4' />
      </button>
      <FloatingContextMenu
        open={open}
        anchorRef={anchor}
        onDismiss={() => setOpen(false)}
        minWidthMin={180}
        class='max-h-64 overflow-y-auto'
      >
        <For each={props.options}>
          {(item) => (
            <button
              type='button'
              role='menuitemradio'
              aria-checked={item.id === props.value ? 'true' : 'false'}
              class='flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground'
              onClick={() => {
                props.onChange(item.id)
                setOpen(false)
              }}
            >
              <span class='w-4'>
                <Show when={item.id === props.value}>
                  <Check class='size-4' />
                </Show>
              </span>
              {item.label}
            </button>
          )}
        </For>
      </FloatingContextMenu>
    </div>
  )
}

export function PickerControls(props: {
  request: PickerRequest
  picker: Picker
  cancel: () => void
}) {
  const acceptLabel = createMemo(
    () =>
      props.request.acceptLabel ||
      (props.request.mode === 'SaveFile'
        ? 'Save'
        : props.request.directory
          ? 'Select folder'
          : 'Open'),
  )
  return (
    <form
      class='shrink-0 space-y-2 border-t border-border bg-background p-3'
      onSubmit={(event) => {
        event.preventDefault()
        void props.picker.accept()
      }}
      aria-label='File picker'
    >
      <Show when={props.request.mode === 'SaveFile'}>
        <label class='flex items-center gap-3 text-sm'>
          Name
          <input
            aria-label='File name'
            class='h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
            value={props.picker.name()}
            onInput={(event) => props.picker.setName(event.currentTarget.value)}
          />
        </label>
      </Show>
      <div class='flex flex-wrap items-center gap-2'>
        <Show when={props.request.filters.length > 0}>
          <PickerChoice
            label='File type'
            value={String(props.picker.filter())}
            options={props.request.filters.map((item, index) => ({
              id: String(index),
              label: item.name,
            }))}
            onChange={(value) => props.picker.setFilter(Number(value))}
          />
        </Show>
        <For each={props.request.choices}>
          {(choice) => (
            <PickerChoice
              label={choice.label}
              value={props.picker.choices()[choice.id] ?? ''}
              options={
                choice.options.length
                  ? choice.options
                  : [
                      { id: 'true', label: `${choice.label}: Yes` },
                      { id: 'false', label: `${choice.label}: No` },
                    ]
              }
              onChange={(value) =>
                props.picker.setChoices((previous) => ({ ...previous, [choice.id]: value }))
              }
            />
          )}
        </For>
        <span class='mr-auto text-sm text-muted-foreground' role='status'>
          {props.picker.selected().length
            ? `${props.picker.selected().length} selected`
            : props.request.directory
              ? 'Choose a folder'
              : ''}
        </span>
        <button
          type='button'
          class='h-9 rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent'
          onClick={() => props.cancel()}
        >
          Cancel
        </button>
        <button
          type='submit'
          disabled={props.picker.pending()}
          class='h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50'
        >
          {acceptLabel()}
        </button>
      </div>
      <Show when={props.picker.error()}>
        <p role='alert' class='text-sm text-destructive'>
          {props.picker.error()}
        </p>
      </Show>
    </form>
  )
}
