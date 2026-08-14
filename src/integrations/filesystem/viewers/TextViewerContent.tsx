import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import type { ResourceKey } from '@/lib/domain/resource'
import {
  createTextDocumentTarget,
  enqueueTextDocumentSave,
  textDocumentPath,
  textDocumentTargetKey,
  type TextDocumentTarget,
} from '@/lib/text-document-target'
import { queryKeys } from '@/lib/query-keys'
import {
  invalidateFileQueries,
  settingsMutationOptions,
  settingsQueryOptions,
} from '@/lib/query-options'
import type { SettingsDto } from '@/lib/generated/api-contracts'
import { buildResolveMarkdownImageUrl } from '@/lib/resolve-markdown-image-url'
import { tryPasteKnowledgeBaseImage } from '@/src/integrations/filesystem/knowledge-base-image-paste'
import { editFilesystemFile } from '@/src/integrations/filesystem/actions'
import { isPathEditable } from '@/lib/utils'
import {
  readTextEditorDraft,
  removeTextEditorDraft,
  textEditorDraftKey,
  writeTextEditorDraft,
} from '@/lib/text-editor-draft'
import AlertCircle from 'lucide-solid/icons/alert-circle'
import Download from 'lucide-solid/icons/download'
import Save from 'lucide-solid/icons/save'
import Zap from 'lucide-solid/icons/zap'
import ZapOff from 'lucide-solid/icons/zap-off'
import { Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js'
import { buildMediaUrl } from '@/lib/api-media-urls'
import { filesystemDownloadHref } from '@/src/integrations/filesystem/download'
import { LazyMarkdownDocument } from '../../../media/LazyMarkdownDocument'
import { completeMarkdownImagePaste } from '../../../media/markdown/paste-completion'
import {
  createTextViewerCloseController,
  registerTextViewerCloseController,
} from '../../../features/viewer/text-viewer-lifecycle'

type TextSaveQueryKey = ReturnType<typeof queryKeys.textContent>

type TextSaveVariables = {
  content: string
  target: TextDocumentTarget
  queryKey: TextSaveQueryKey
}

export type TextViewerContentProps = {
  contentInstanceId: string
  resource: ResourceKey
  viewingPath: string
  editableFolders: string[]
  knowledgeBases?: string[]
  onClose?: () => void
}

export function TextViewerContent(props: TextViewerContentProps): JSX.Element {
  const queryClient = useQueryClient()

  const settingsQuery = useQuery(settingsQueryOptions)

  const autoSaveMutation = useMutation(() => ({
    ...settingsMutationOptions.autoSave(queryClient),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.settings() })
      const prev = queryClient.getQueryData<SettingsDto>(queryKeys.settings())
      queryClient.setQueryData<SettingsDto>(queryKeys.settings(), (old) => {
        if (!old)
          return {
            viewModes: {},
            favorites: [],
            knowledgeBases: [],
            customIcons: {},
            workspaceTaskbarPins: [],
            workspaceLayoutPresets: [],
            autoSave: {
              [vars.filePath]: {
                enabled: vars.enabled,
                ...(vars.readOnly !== undefined && { readOnly: vars.readOnly }),
              },
            },
          }
        return {
          ...old,
          autoSave: {
            ...old.autoSave,
            [vars.filePath]: {
              enabled: vars.enabled,
              ...(vars.readOnly !== undefined && { readOnly: vars.readOnly }),
            },
          },
        }
      })
      return { prev }
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(queryKeys.settings(), context.prev)
    },
  }))

  const mediaUrl = createMemo(() => buildMediaUrl(props.viewingPath))

  const currentTextTarget = createMemo(() => createTextDocumentTarget(props.resource))
  const currentTextTargetKey = createMemo(() => textDocumentTargetKey(currentTextTarget()))

  const queryKey = createMemo(() => {
    return queryKeys.textContent(textDocumentPath(currentTextTarget()))
  })

  const textQuery = useQuery(() => ({
    queryKey: queryKey(),
    queryFn: async () => {
      const url = mediaUrl()
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to load file')
      return await res.text()
    },
  }))

  const fileEditable = createMemo(() => {
    return isPathEditable(props.viewingPath, props.editableFolders)
  })

  const autoSaveEnabled = createMemo(() => {
    const s = settingsQuery.data?.autoSave?.[props.viewingPath]
    return s?.enabled ?? true
  })

  const persistedReadOnly = createMemo(() => {
    return settingsQuery.data?.autoSave?.[props.viewingPath]?.readOnly ?? false
  })

  const ext = createMemo(() => props.viewingPath.split('.').pop()?.toLowerCase() || '')
  const isMarkdown = createMemo(() => ext() === 'md')

  const [readOnlyView, setReadOnlyView] = createSignal(false)
  const [editContent, setEditContent] = createSignal('')
  const [editorBaseContent, setEditorBaseContent] = createSignal('')
  const [savedContentAwaitingQuery, setSavedContentAwaitingQuery] = createSignal<string | null>(
    null,
  )
  const [copied, setCopied] = createSignal(false)
  const [autoSaveError, setAutoSaveError] = createSignal<string | null>(null)
  const [pendingSaveTargets, setPendingSaveTargets] = createSignal<ReadonlyMap<string, number>>(
    new Map(),
  )
  const pendingSaveOperations = new Set<Promise<void>>()

  let lastDocumentKey = ''
  let hydratedDocumentKey = ''
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null

  const isCurrentSaveTarget = (variables: TextSaveVariables) =>
    textDocumentTargetKey(variables.target) === currentTextTargetKey()
  const currentSavePending = createMemo(
    () => (pendingSaveTargets().get(currentTextTargetKey()) ?? 0) > 0,
  )

  const updatePendingSaveCount = (target: TextDocumentTarget, delta: 1 | -1) => {
    const targetKey = textDocumentTargetKey(target)
    setPendingSaveTargets((current) => {
      const next = new Map(current)
      const count = (next.get(targetKey) ?? 0) + delta
      if (count > 0) next.set(targetKey, count)
      else next.delete(targetKey)
      return next
    })
  }

  const textSaveVariables = (): TextSaveVariables => {
    return {
      content: editContent(),
      target: currentTextTarget(),
      queryKey: queryKey(),
    }
  }

  const saveMutation = useMutation(() => ({
    mutationFn: async (variables: TextSaveVariables) => {
      updatePendingSaveCount(variables.target, 1)
      try {
        return await enqueueTextDocumentSave(variables.target, async () => {
          const { content, target } = variables
          await editFilesystemFile(textDocumentPath(target), { content })
          return content
        })
      } finally {
        updatePendingSaveCount(variables.target, -1)
      }
    },
    onSuccess: (content: string, variables) => {
      if (isCurrentSaveTarget(variables)) setSavedContentAwaitingQuery(content)
      queryClient.setQueryData(variables.queryKey, content)
      void queryClient.invalidateQueries({ queryKey: variables.queryKey })
    },
    onSettled: () => invalidateFileQueries(queryClient),
  }))

  function saveInternal(quiet: boolean): Promise<void> {
    if (quiet && editContent() === editorBaseContent()) return Promise.resolve()
    const request = (async () => {
      if (!quiet) setAutoSaveError(null)
      const variables = textSaveVariables()
      try {
        await saveMutation.mutateAsync(variables)
        if (isCurrentSaveTarget(variables)) {
          if (editContent() === variables.content) setEditorBaseContent(variables.content)
          if (quiet) setAutoSaveError(null)
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to save file'
        if (isCurrentSaveTarget(variables)) setAutoSaveError(message)
        if (!quiet && isCurrentSaveTarget(variables)) window.alert(message)
      }
    })()
    pendingSaveOperations.add(request)
    void request.finally(() => pendingSaveOperations.delete(request))
    return request
  }

  async function awaitPendingSaves() {
    while (pendingSaveOperations.size > 0) {
      await Promise.all([...pendingSaveOperations])
    }
  }

  createEffect(() => {
    const target = currentTextTarget()
    const documentKey = textDocumentTargetKey(target)
    const pr = persistedReadOnly()
    if (!textDocumentPath(target)) return
    if (documentKey !== lastDocumentKey) {
      lastDocumentKey = documentKey
      hydratedDocumentKey = ''
      setSavedContentAwaitingQuery(null)
      setReadOnlyView(pr)
      setEditContent('')
      setEditorBaseContent('')
      setCopied(false)
      setAutoSaveError(null)
    }

    void textQuery.data
    const data = queryClient.getQueryData<string>(queryKey())
    if (data === undefined) return
    if (documentKey !== hydratedDocumentKey) {
      hydratedDocumentKey = documentKey
      const draft = readTextEditorDraft(textEditorDraftKey(target.resource))
      setEditContent(draft?.content !== data ? (draft?.content ?? data) : data)
      setEditorBaseContent(data)
    } else {
      const savedContent = savedContentAwaitingQuery()
      if (savedContent !== null && data === savedContent) {
        setEditorBaseContent(savedContent)
        setSavedContentAwaitingQuery(null)
      } else if (data !== editorBaseContent() && editContent() === editorBaseContent()) {
        setEditContent(data)
        setEditorBaseContent(data)
      }
    }
  })

  const draftKey = createMemo(() => textEditorDraftKey(currentTextTarget().resource))
  const dirty = createMemo(() => editContent() !== editorBaseContent())
  const conflict = createMemo(
    () => dirty() && textQuery.data !== undefined && textQuery.data !== editorBaseContent(),
  )

  const closeController = createTextViewerCloseController({
    autoSaveEnabled,
    dirty,
    editable: fileEditable,
    conflict,
    cancelScheduledSave() {
      if (!autosaveTimer) return
      clearTimeout(autosaveTimer)
      autosaveTimer = null
    },
    awaitPendingSaves,
    save: () => saveInternal(true),
  })

  createEffect(() => {
    const instanceId = props.contentInstanceId
    if (!instanceId) return
    const unregister = registerTextViewerCloseController(instanceId, closeController)
    onCleanup(unregister)
  })

  createEffect(() => {
    if (hydratedDocumentKey !== currentTextTargetKey()) return
    if (dirty() && autoSaveEnabled()) writeTextEditorDraft(draftKey(), editContent())
    else removeTextEditorDraft(draftKey())
  })

  createEffect(() => {
    const warnIfDirty = (event: BeforeUnloadEvent) => {
      if (!dirty()) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnIfDirty)
    onCleanup(() => window.removeEventListener('beforeunload', warnIfDirty))
  })

  createEffect(() => {
    onCleanup(() => {
      if (autosaveTimer) {
        clearTimeout(autosaveTimer)
        autosaveTimer = null
      }
    })
    if (hydratedDocumentKey !== currentTextTargetKey()) return
    if (!fileEditable() || readOnlyView() || !autoSaveEnabled() || conflict()) return
    if (editContent() === editorBaseContent()) return
    autosaveTimer = setTimeout(() => {
      void saveInternal(true)
    }, 2000)
  })

  async function handleClose() {
    if (!(await closeController.canClose())) return
    props.onClose?.()
  }

  function toggleAutoSave() {
    autoSaveMutation.mutate({ filePath: props.viewingPath, enabled: !autoSaveEnabled() })
  }

  function toggleReadOnlyFromEditor() {
    setReadOnlyView(true)
    autoSaveMutation.mutate({
      filePath: props.viewingPath,
      enabled: autoSaveEnabled(),
      readOnly: true,
    })
  }

  function enterEditMode() {
    setReadOnlyView(false)
    autoSaveMutation.mutate({
      filePath: props.viewingPath,
      enabled: autoSaveEnabled(),
      readOnly: false,
    })
  }

  async function handleCopy() {
    const src = fileEditable() ? editContent() : (textQuery.data ?? '')
    if (!src) return
    try {
      await navigator.clipboard.writeText(src)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const kbList = () => props.knowledgeBases ?? []
  const resolveImageUrl = createMemo(() =>
    buildResolveMarkdownImageUrl(props.viewingPath, kbList()),
  )

  const fileName = createMemo(() => props.viewingPath.split(/[/\\]/).pop() || '')
  const showEditor = createMemo(() => fileEditable() && !readOnlyView())
  const lineCount = createMemo(() => (textQuery.data ?? '').split('\n').length)
  const downloadHref = createMemo(() => filesystemDownloadHref(props.viewingPath))

  return (
    <div
      data-testid='text-viewer-content'
      class='flex h-full min-h-0 flex-col bg-background/95 backdrop-blur-sm'
    >
      <header class='border-border bg-background/90 flex h-auto min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2'>
        <div class='min-w-0 flex-1'>
          <h2 id='text-viewer-title' class='truncate text-lg font-medium'>
            {fileName()}
          </h2>
          <p class='text-muted-foreground text-sm'>
            {ext().toUpperCase()} File{' '}
            <Show when={(textQuery.data ?? '').length > 0}>
              <span>• {lineCount()} lines</span>
            </Show>
          </p>
        </div>
        <div class='flex flex-wrap items-center gap-2'>
          <Show when={showEditor()}>
            <Show when={fileEditable()}>
              <div class='mr-2 flex flex-wrap items-center gap-2 border-r border-border pr-3'>
                <button
                  type='button'
                  class={`rounded-md px-2 py-1 text-sm ${
                    autoSaveEnabled()
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'border border-border bg-background hover:bg-muted'
                  }`}
                  onClick={() => toggleAutoSave()}
                  title={autoSaveEnabled() ? 'Auto-save enabled' : 'Auto-save disabled'}
                >
                  <span class='inline-flex items-center gap-1.5'>
                    <Show
                      when={autoSaveEnabled()}
                      fallback={<ZapOff class='h-4 w-4' stroke-width={2} />}
                    >
                      <Zap class='h-4 w-4' stroke-width={2} />
                    </Show>
                    Auto-save
                  </span>
                </button>
                <Show when={autoSaveError()}>
                  <button
                    type='button'
                    class='text-destructive inline-flex items-center gap-1 text-xs hover:underline'
                    title={autoSaveError() ?? ''}
                    onClick={() => void saveInternal(true)}
                  >
                    <AlertCircle class='h-4 w-4 shrink-0' stroke-width={2} />
                    Save failed — retry
                  </button>
                </Show>
              </div>
            </Show>
            <button
              type='button'
              class='hover:bg-muted rounded-md px-2 py-1 text-sm disabled:opacity-50'
              disabled={currentSavePending()}
              onClick={() => toggleReadOnlyFromEditor()}
              title='Switch to read-only mode'
            >
              Read only
            </button>
            <Show when={!autoSaveEnabled()}>
              <button
                type='button'
                class='bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm disabled:opacity-50'
                disabled={currentSavePending()}
                onClick={() => void saveInternal(false)}
                title='Save changes'
              >
                <Save class='h-4 w-4' stroke-width={2} />
                {currentSavePending() ? 'Saving…' : 'Save'}
              </button>
            </Show>
          </Show>
          <Show when={!showEditor()}>
            <Show when={fileEditable()}>
              <button
                type='button'
                class='bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm'
                onClick={() => enterEditMode()}
                title='Edit file'
              >
                Edit
              </button>
            </Show>
            <button
              type='button'
              title='Copy to clipboard'
              class='hover:bg-muted inline-flex h-8 w-8 items-center justify-center rounded-md'
              onClick={() => void handleCopy()}
            >
              <span class='sr-only'>Copy to clipboard</span>
              {copied() ? '✓' : '⎘'}
            </button>
          </Show>
          <button
            type='button'
            title='Download'
            aria-label='Download'
            class='hover:bg-muted inline-flex h-8 w-8 items-center justify-center rounded-md'
            onClick={() => {
              const a = document.createElement('a')
              a.href = downloadHref()
              a.download = fileName()
              a.click()
            }}
          >
            <Download class='h-5 w-5' stroke-width={2} aria-hidden='true' />
          </button>
          <Show when={props.onClose}>
            <button
              type='button'
              title='Close'
              class='hover:bg-muted inline-flex h-8 w-8 items-center justify-center rounded-md'
              onClick={() => void handleClose()}
            >
              <span class='sr-only'>Close</span>×
            </button>
          </Show>
        </div>
      </header>
      <div class='min-h-0 flex-1 overflow-hidden'>
        <Show when={conflict()}>
          <div class='flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-900 dark:text-amber-200'>
            <span>This file changed elsewhere. Your unsaved edits were kept.</span>
            <button
              type='button'
              class='shrink-0 underline'
              onClick={() => {
                const remote = textQuery.data ?? ''
                setEditContent(remote)
                setEditorBaseContent(remote)
              }}
            >
              Reload remote version
            </button>
          </div>
        </Show>
        <Show when={textQuery.isPending}>
          <p class='text-muted-foreground p-4 text-sm'>Loading…</p>
        </Show>
        <Show when={textQuery.isError}>
          <p class='text-destructive p-4 text-sm'>Failed to load file.</p>
        </Show>
        <Show when={!textQuery.isPending && !textQuery.isError}>
          <Show
            when={isMarkdown()}
            fallback={
              <Show
                when={showEditor()}
                fallback={
                  <div class='h-full overflow-auto p-4'>
                    <pre class='wrap-break-word whitespace-pre-wrap font-sans text-base leading-[1.75] text-foreground'>
                      {textQuery.data ?? ''}
                    </pre>
                  </div>
                }
              >
                <div class='h-full p-4'>
                  <textarea
                    class='border-input bg-background focus-visible:ring-ring h-full w-full resize-none rounded-lg border p-4 font-sans text-base leading-[1.75] text-foreground wrap-break-word whitespace-pre-wrap focus-visible:ring-2 focus-visible:outline-none'
                    value={editContent()}
                    spellcheck={false}
                    placeholder='Enter text…'
                    onInput={(e) => setEditContent(e.currentTarget.value)}
                    onBlur={() => {
                      if (autoSaveEnabled() && !conflict()) void saveInternal(true)
                    }}
                    onKeyDown={(e) => {
                      if (
                        e.key === 'ArrowLeft' ||
                        e.key === 'ArrowRight' ||
                        e.key === 'ArrowUp' ||
                        e.key === 'ArrowDown' ||
                        e.key === 'Home' ||
                        e.key === 'End' ||
                        e.key === 'PageUp' ||
                        e.key === 'PageDown'
                      ) {
                        e.stopPropagation()
                      }
                    }}
                  />
                </div>
              </Show>
            }
          >
            <Show keyed when={currentTextTargetKey()}>
              {(_documentKey) => (
                <LazyMarkdownDocument
                  content={fileEditable() ? editContent() : (textQuery.data ?? '')}
                  mode={showEditor() ? 'edit' : 'read'}
                  onChange={setEditContent}
                  onBlur={() => {
                    if (fileEditable() && autoSaveEnabled() && !conflict()) void saveInternal(true)
                  }}
                  onSave={() => saveInternal(false)}
                  resolveImageUrl={resolveImageUrl()}
                  onPasteImage={(event, _selection, complete) => {
                    const pasteTargetKey = currentTextTargetKey()
                    return tryPasteKnowledgeBaseImage(event, {
                      viewingPath: props.viewingPath,
                      knowledgeBases: kbList(),
                      editableFolders: props.editableFolders,
                      completeCodeMirrorPaste: (markdown) =>
                        completeMarkdownImagePaste(
                          markdown,
                          complete,
                          () =>
                            pasteTargetKey === currentTextTargetKey() &&
                            hydratedDocumentKey === pasteTargetKey &&
                            fileEditable() &&
                            readOnlyView() &&
                            autoSaveEnabled() &&
                            !conflict(),
                          () => void saveInternal(true),
                        ),
                    })
                  }}
                  ariaLabel={`${fileName()} Markdown ${showEditor() ? 'editor' : 'document'}`}
                />
              )}
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  )
}
