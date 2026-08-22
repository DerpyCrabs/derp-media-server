import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import { useSettingsQuery } from '@/lib/api/use-app-data'
import { post } from '@/lib/api/client'
import {
  createTextDocumentTarget,
  enqueueTextDocumentSave,
  textDocumentTargetKey,
  type TextDocumentTarget,
} from '@/features/viewer/text-document-target'
import { queryKeys } from '@/lib/api/query-keys'
import type { GlobalSettings } from '@/lib/models/settings-types'
import { buildResolveMarkdownImageUrl } from '@/lib/markdown/resolve-markdown-image-url'
import { tryPasteKnowledgeBaseImage } from '@/features/viewer/handle-kb-image-paste'
import { isPathEditable } from '@/lib/files/path-utils'
import AlertCircle from 'lucide-solid/icons/alert-circle'
import Download from 'lucide-solid/icons/download'
import Save from 'lucide-solid/icons/save'
import Zap from 'lucide-solid/icons/zap'
import ZapOff from 'lucide-solid/icons/zap-off'
import { Show, createEffect, createMemo, createSignal, onSettled, untrack } from 'solid-js'
import type { JSX } from '@solidjs/web'
import { closeViewer } from '@/lib/browser/url-state-actions'
import { fileDownloadHref } from '@/lib/files/download-urls'
import { LazyMarkdownDocument } from '@/lib/markdown/LazyMarkdownDocument'
import { completeMarkdownImagePaste } from '@/lib/markdown/paste-completion'
import { showAppAlert } from '@/lib/ui/app-dialog'

type TextSaveQueryKey = ReturnType<typeof queryKeys.textContent>
type TextDocumentRemote = { content: string; version: string }

type TextSaveVariables = {
  content: string
  baseVersion: string
  target: TextDocumentTarget
  queryKey: TextSaveQueryKey
}

export type TextEditorPaneProps = {
  viewingPath: string
  editableFolders: string[]
  knowledgeBases?: string[]
  embedded?: boolean
  showClose?: boolean
  onClose?: () => void
}

export function TextEditorPane(props: TextEditorPaneProps): JSX.Element {
  const queryClient = useQueryClient()

  const settingsQuery = useSettingsQuery()

  const autoSaveMutation = useMutation(() => ({
    mutationFn: (vars: { filePath: string; enabled: boolean; readOnly?: boolean }) =>
      post('/api/settings/autoSave', vars),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.settings() })
      queryClient.setQueryData<GlobalSettings>(queryKeys.settings(), (old) => {
        if (!old)
          return {
            viewModes: {},
            sortOrders: {},
            fileColumns: {
              media: { createdDate: false, size: true, favorite: true, views: true },
              workspace: { createdDate: false, size: true, favorite: false, views: false },
            },
            favorites: [],
            knowledgeBases: [],
            customIcons: {},
            workspaceTransition: 'fade',
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
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
    },
  }))

  const currentTextTarget = createMemo(() => createTextDocumentTarget(props.viewingPath))
  const currentTextTargetKey = createMemo(() => textDocumentTargetKey(currentTextTarget()))

  const queryKey = createMemo(() => {
    return queryKeys.textContent(currentTextTarget().viewingPath)
  })

  const textQuery = useQuery(() => ({
    queryKey: queryKey(),
    queryFn: async () => {
      const url = `/api/files/text?path=${encodeURIComponent(currentTextTarget().viewingPath)}`
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to load file')
      return (await res.json()) as TextDocumentRemote
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
  const [baseVersion, setBaseVersion] = createSignal('')
  const [saveCount, setSaveCount] = createSignal(0)
  const [copied, setCopied] = createSignal(false)
  const [autoSaveError, setAutoSaveError] = createSignal<string | null>(null)

  let lastDocumentKey = ''
  let hydratedDocumentKey = ''
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null
  const isCurrentSaveTarget = (variables: TextSaveVariables) =>
    textDocumentTargetKey(variables.target) === currentTextTargetKey()
  const currentSavePending = () => saveCount() > 0

  const textSaveVariables = (): TextSaveVariables => {
    return {
      content: editContent(),
      baseVersion: baseVersion(),
      target: currentTextTarget(),
      queryKey: queryKey(),
    }
  }

  const saveMutation = useMutation(() => ({
    mutationFn: async (variables: TextSaveVariables) => {
      setSaveCount((count) => count + 1)
      try {
        return await enqueueTextDocumentSave(variables.target, async () => {
          const result = await post<{ version: string }>('/api/files/edit', {
            path: variables.target.viewingPath,
            content: variables.content,
            expectedHash: variables.baseVersion,
          })
          return { content: variables.content, version: result.version }
        })
      } finally {
        setSaveCount((count) => Math.max(0, count - 1))
      }
    },
    onSuccess: (saved: TextDocumentRemote, variables) => {
      if (isCurrentSaveTarget(variables)) {
        setEditorBaseContent(saved.content)
        setBaseVersion(saved.version)
      }
      queryClient.setQueryData(variables.queryKey, saved)
      void queryClient.invalidateQueries({ queryKey: variables.queryKey })
    },
  }))

  async function saveInternal(quiet: boolean) {
    if (quiet && editContent() === editorBaseContent()) return
    if (!quiet) setAutoSaveError(null)
    const variables = textSaveVariables()
    try {
      await saveMutation.mutateAsync(variables)
      if (quiet && isCurrentSaveTarget(variables)) setAutoSaveError(null)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to save file'
      if (isCurrentSaveTarget(variables)) setAutoSaveError(message)
      if (!quiet && isCurrentSaveTarget(variables))
        void showAppAlert(message, 'Could not save file')
    }
  }

  createEffect(
    () => {
      const target = currentTextTarget()
      if (!target.viewingPath) return null
      const documentKey = textDocumentTargetKey(target)
      return {
        target,
        documentKey,
        readOnly: persistedReadOnly(),
        data: textQuery.data,
      }
    },
    (state) => {
      if (!state) return
      const { documentKey, readOnly: pr, data } = state
      if (documentKey !== lastDocumentKey) {
        lastDocumentKey = documentKey
        hydratedDocumentKey = ''
        setReadOnlyView(pr)
        setEditContent('')
        setEditorBaseContent('')
        setBaseVersion('')
        setCopied(false)
        setAutoSaveError(null)
      }

      if (data === undefined) return
      if (documentKey !== hydratedDocumentKey || editContent() === editorBaseContent()) {
        setEditContent(data.content)
        setEditorBaseContent(data.content)
        setBaseVersion(data.version)
      }
      hydratedDocumentKey = documentKey
    },
  )

  const dirty = () => editContent() !== editorBaseContent()
  const conflict = () =>
    dirty() && textQuery.data !== undefined && textQuery.data.version !== baseVersion()

  onSettled(() => {
    const warnIfDirty = (event: BeforeUnloadEvent) => {
      if (!dirty()) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnIfDirty)
    // eslint-disable-next-line solid/reactivity
    return () => window.removeEventListener('beforeunload', warnIfDirty)
  })

  createEffect(
    () => ({
      ready: hydratedDocumentKey === currentTextTargetKey(),
      editable: fileEditable(),
      readOnly: readOnlyView(),
      autoSave: autoSaveEnabled(),
      hasConflict: conflict(),
      saving: currentSavePending(),
      edit: editContent(),
      base: editorBaseContent(),
    }),
    ({ ready, editable, readOnly, autoSave, hasConflict, saving, edit, base }) => {
      if (autosaveTimer) {
        clearTimeout(autosaveTimer)
        autosaveTimer = null
      }
      if (!ready || !editable || readOnly || !autoSave || hasConflict || saving || edit === base)
        return undefined
      autosaveTimer = setTimeout(() => {
        void saveInternal(true)
      }, 2000)
      // eslint-disable-next-line solid/reactivity
      return () => {
        if (autosaveTimer) {
          clearTimeout(autosaveTimer)
          autosaveTimer = null
        }
      }
    },
  )

  async function handleClose() {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer)
      autosaveTimer = null
    }
    if (
      fileEditable() &&
      autoSaveEnabled() &&
      !conflict() &&
      editContent() !== editorBaseContent()
    ) {
      await saveInternal(true)
    }
    if (autoSaveEnabled() && dirty()) return
    if (props.onClose) props.onClose()
    else closeViewer()
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
    const src = fileEditable() ? editContent() : (textQuery.data?.content ?? '')
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
  const remoteContent = () => textQuery.data?.content ?? ''
  const lineCount = createMemo(() => remoteContent().split('\n').length)
  const downloadHref = createMemo(() => fileDownloadHref(props.viewingPath))

  function handleDownload() {
    const a = document.createElement('a')
    a.href = downloadHref()
    a.download = fileName()
    a.click()
  }

  return (
    <div
      role={props.embedded ? undefined : 'dialog'}
      aria-modal={props.embedded ? undefined : 'true'}
      aria-labelledby='text-viewer-title'
      class={
        props.embedded
          ? 'flex h-full min-h-0 flex-col bg-background'
          : 'fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm'
      }
    >
      <header
        class={
          props.embedded
            ? 'flex h-9 shrink-0 flex-wrap items-center gap-1 border-b border-border bg-muted/50 px-2'
            : 'border-border bg-background/90 flex h-auto min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2'
        }
      >
        <Show when={props.embedded}>
          <span class='text-muted-foreground flex items-center gap-1 text-xs'>
            {ext().toUpperCase()}
            <Show when={lineCount() > 0}>
              <> &middot; {lineCount()} lines</>
            </Show>
          </span>
        </Show>
        <Show when={!props.embedded}>
          <div class='min-w-0 flex-1'>
            <h2
              id='text-viewer-title'
              class={
                props.embedded
                  ? 'text-muted-foreground truncate text-xs font-normal'
                  : 'truncate text-lg font-medium'
              }
            >
              {props.embedded ? ext().toUpperCase() : fileName()}
            </h2>
            <p
              class={
                props.embedded ? 'text-muted-foreground text-xs' : 'text-muted-foreground text-sm'
              }
            >
              <Show
                when={props.embedded}
                fallback={
                  <>
                    {ext().toUpperCase()} File{' '}
                    <Show when={remoteContent().length > 0}>
                      <span>• {lineCount()} lines</span>
                    </Show>
                  </>
                }
              >
                <Show when={remoteContent().length > 0}>
                  <span>&middot; {lineCount()} lines</span>
                </Show>
              </Show>
            </p>
          </div>
        </Show>
        <div
          class={
            props.embedded
              ? 'ml-auto flex min-w-0 items-center gap-0.5'
              : 'flex flex-wrap items-center gap-2'
          }
        >
          <Show when={showEditor()}>
            <Show when={fileEditable()}>
              <div
                class={
                  props.embedded
                    ? 'contents'
                    : 'mr-2 flex flex-wrap items-center gap-2 border-r border-border pr-3'
                }
              >
                <Show when={!props.embedded}>
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
                </Show>
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
              class={
                props.embedded
                  ? 'hover:bg-muted rounded-md px-2 py-1 text-xs disabled:opacity-50'
                  : 'hover:bg-muted rounded-md px-2 py-1 text-sm disabled:opacity-50'
              }
              disabled={currentSavePending()}
              onClick={() => toggleReadOnlyFromEditor()}
              title='Switch to read-only mode'
            >
              Read only
            </button>
            <Show when={!autoSaveEnabled() && !props.embedded}>
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
                class={
                  props.embedded
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-2 py-1 text-xs'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm'
                }
                onClick={() => enterEditMode()}
                title='Edit file'
              >
                Edit
              </button>
            </Show>
            <button
              type='button'
              title='Copy to clipboard'
              class={
                props.embedded
                  ? 'hover:bg-muted inline-flex h-7 w-7 items-center justify-center rounded-md text-sm'
                  : 'hover:bg-muted inline-flex h-8 w-8 items-center justify-center rounded-md'
              }
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
            class={
              props.embedded
                ? 'hover:bg-muted inline-flex h-7 w-7 items-center justify-center rounded-md'
                : 'hover:bg-muted inline-flex h-8 w-8 items-center justify-center rounded-md'
            }
            onClick={handleDownload}
          >
            <Download
              class={props.embedded ? 'h-3.5 w-3.5' : 'h-5 w-5'}
              stroke-width={2}
              aria-hidden='true'
            />
          </button>
          <button
            type='button'
            title='Close'
            style={{ display: props.showClose === false ? 'none' : undefined }}
            class={
              props.embedded
                ? 'hover:bg-muted inline-flex h-7 w-7 items-center justify-center rounded-md'
                : 'hover:bg-muted inline-flex h-8 w-8 items-center justify-center rounded-md'
            }
            onClick={() => void handleClose()}
          >
            <span class='sr-only'>Close</span>×
          </button>
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
                const remote = textQuery.data
                if (!remote) return
                setEditContent(remote.content)
                setEditorBaseContent(remote.content)
                setBaseVersion(remote.version)
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
                  <div class={props.embedded ? 'h-full overflow-auto' : 'h-full overflow-auto p-4'}>
                    <pre
                      class={
                        props.embedded
                          ? 'wrap-break-word whitespace-pre-wrap px-3 py-2 font-sans text-base leading-[1.75] text-foreground'
                          : 'wrap-break-word whitespace-pre-wrap font-sans text-base leading-[1.75] text-foreground'
                      }
                    >
                      {remoteContent()}
                    </pre>
                  </div>
                }
              >
                <div class={props.embedded ? 'h-full' : 'h-full p-4'}>
                  <textarea
                    class={
                      props.embedded
                        ? 'bg-transparent font-sans text-base leading-[1.75] text-foreground h-full w-full resize-none px-3 py-2 wrap-break-word whitespace-pre-wrap focus:outline-none'
                        : 'border-input bg-background focus-visible:ring-ring h-full w-full resize-none rounded-lg border p-4 font-sans text-base leading-[1.75] text-foreground wrap-break-word whitespace-pre-wrap focus-visible:ring-2 focus-visible:outline-none'
                    }
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
                  content={fileEditable() ? editContent() : remoteContent()}
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
                            untrack(
                              () =>
                                pasteTargetKey === currentTextTargetKey() &&
                                hydratedDocumentKey === pasteTargetKey &&
                                fileEditable() &&
                                readOnlyView() &&
                                autoSaveEnabled() &&
                                !conflict(),
                            ),
                          () => untrack(() => void saveInternal(true)),
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
