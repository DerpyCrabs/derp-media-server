import { Cause, Effect } from 'effect'
import { modelOwner } from 'effectweb'
import type { FileBrowserHost } from '@/features/explorer/FileBrowser'
import type { FileItem } from '@/lib/files/types'
import { showAppConfirmEffect } from '@/lib/ui/app-dialog'
import type { DesktopBridge, PickerRequest } from './bridge'
import { pickerFileVisible } from './picker-files'
const bridgeFailure = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause))

type Accessor<T> = () => T
export function createPicker(options: {
  request: Accessor<PickerRequest | undefined>
  directory: Accessor<string>
  navigate: (path: string) => void
  bridge: DesktopBridge | undefined
}) {
  const initial = {
    selected: [] as readonly FileItem[],
    anchor: '',
    name: '',
    filter: 0,
    choices: {} as Record<string, string>,
    pending: false,
    error: '',
  }
  const owner = modelOwner(initial)
  const selected = () => owner.read().selected
  const setSelected = (
    value: readonly FileItem[] | ((current: readonly FileItem[]) => readonly FileItem[]),
  ) => owner.patch({ selected: typeof value === 'function' ? value(selected()) : value })
  const anchor = () => owner.read().anchor
  const setAnchor = (anchor: string) => owner.patch({ anchor })
  const filter = () => owner.read().filter
  const setName = (name: string) => owner.patch({ name })
  const setFilter = (filter: number) => owner.patch({ filter })
  const setChoice = (id: string, value: string) =>
    owner.edit('choices', (current) => ({ ...current, [id]: value }))
  const acceptSlot = 'picker-accept'
  const copySlot = 'picker-copy'
  let disposed = false
  let requestGeneration = 0
  let previousRequest: PickerRequest | undefined
  let previousDirectory = options.directory()
  let previousFilter = filter()
  function receive() {
    const request = options.request()
    if (request !== previousRequest) {
      owner.cancel(acceptSlot)
      owner.cancel(copySlot)
      previousRequest = request
      requestGeneration += 1
      owner.patch({ pending: false, error: '' })
      if (request)
        owner.patch({
          name: request.name,
          filter: request.filter,
          choices: Object.fromEntries(
            request.choices.map((choice) => [
              choice.id,
              choice.selected || choice.options[0]?.id || 'false',
            ]),
          ),
        })
    }
    const directory = options.directory()
    if (directory !== previousDirectory || filter() !== previousFilter) {
      previousDirectory = directory
      previousFilter = filter()
      owner.patch({ selected: [], anchor: '', error: '' })
    }
  }
  const stop = owner.source.subscribe(receive)
  const eligible = (file: FileItem) =>
    !file.isVirtual && file.isDirectory === !!options.request()?.directory
  const visible = (file: FileItem) => pickerFileVisible(file, options.request(), filter())
  function accept(files = selected()) {
    const work = Effect.gen(function* () {
      const request = options.request()
      const bridge = options.bridge
      if (disposed || !request || owner.read().pending || !bridge?.pick) return
      const generation = requestGeneration
      const current = () =>
        !disposed && generation === requestGeneration && options.request() === request
      if (!request.directory && files.length === 1 && files[0]!.isDirectory) {
        options.navigate(files[0]!.path)
        return
      }
      const state = owner.read()
      const destination =
        request.mode === 'SaveFiles' && files[0]?.isDirectory ? files[0].path : options.directory()
      const paths = files.filter(eligible).map((file) => file.path)
      if (request.directory && !paths.length) paths.push(options.directory())
      if (request.mode === 'OpenFile' && !paths.length) return
      if (request.mode === 'SaveFile' && !state.name.trim()) return
      owner.patch({ pending: true, error: '' })
      const selection = {
        paths,
        directory: destination,
        name: state.name,
        filter: state.filter,
        choices: { ...state.choices },
      }
      yield* Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: () => bridge.pick!(selection),
          catch: bridgeFailure,
        })
        if (!current()) return
        if (
          result.overwrite?.length &&
          (yield* showAppConfirmEffect({
            title: 'Replace file?',
            message: `${selection.name} already exists. Replace it?`,
            confirmLabel: 'Replace',
            destructive: true,
          }))
        ) {
          if (current())
            yield* Effect.tryPromise({
              try: () => bridge.pick!({ ...selection, overwrite: true }),
              catch: bridgeFailure,
            })
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            if (current() && !Cause.hasInterruptsOnly(cause)) {
              const error = Cause.squash(cause)
              owner.patch({ error: error instanceof Error ? error.message : String(error) })
            }
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            if (current()) owner.patch({ pending: false })
          }),
        ),
      )
    })
    owner.run(acceptSlot, work, 'drop')
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
        accept([file])
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
        accept()
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'c' &&
        selected().length
      ) {
        event.preventDefault()
        const bridge = options.bridge
        if (bridge)
          owner.run(
            copySlot,
            Effect.tryPromise({
              try: () => bridge.copy(selected().map((file) => file.path)),
              catch: bridgeFailure,
            }).pipe(
              Effect.catch((cause) => Effect.sync(() => owner.patch({ error: cause.message }))),
            ),
            'drop',
          )
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
    source: owner.source,
    awaitIdle: () => owner.awaitIdle(acceptSlot),
    receive,
    dispose() {
      disposed = true
      stop()
      owner.dispose()
    },
    setName,
    setFilter,
    setChoice,
    accept,
    selection,
  }
}

export type Picker = ReturnType<typeof createPicker>
