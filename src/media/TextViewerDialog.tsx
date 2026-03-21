import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import { api, post } from '@/lib/api'
import { MediaType } from '@/lib/types'
import { getMediaType } from '@/lib/media-utils'
import { queryKeys } from '@/lib/query-keys'
import type { GlobalSettings } from '@/lib/use-settings'
import { getKnowledgeBaseRoot, isPathEditable } from '@/lib/utils'
import AlertCircle from 'lucide-solid/icons/alert-circle'
import Download from 'lucide-solid/icons/download'
import Save from 'lucide-solid/icons/save'
import Zap from 'lucide-solid/icons/zap'
import ZapOff from 'lucide-solid/icons/zap-off'
import { Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js'
import { useBrowserHistory } from '../browser-history'
import {
  getShareTextViewerSettings,
  migrateLegacyShareTextViewerKey,
  setShareTextViewerSettings,
  type ShareTextViewerSettings,
} from '../lib/share-text-viewer-settings'
import { closeViewer } from '../lib/url-state-actions'
import { buildAdminMediaUrl, buildShareMediaUrl } from '../lib/build-media-url'
import { MarkdownPane } from './MarkdownPane'

export type TextViewerShareContext = {
  token: string
  sharePath: string
  isDirectory: boolean
}

type Props = {
  shareContext?: TextViewerShareContext | null
  /** When browsing as admin; ignored if shareContext is set. */
  editableFolders?: string[]
  /** For Obsidian-style image embeds in knowledge bases (admin). */
  knowledgeBases?: string[]
  /** Share link allows editing (editable + allowEdit). */
  shareCanEdit?: boolean
}

function shareEditRelativePath(viewingPath: string, ctx: TextViewerShareContext): string {
  const sp = ctx.sharePath.replace(/\\/g, '/')
  const fileFwd = viewingPath.replace(/\\/g, '/')
  if (!ctx.isDirectory) {
    return fileFwd === sp ? '.' : fileFwd
  }
  return fileFwd.startsWith(sp + '/') ? fileFwd.slice(sp.length + 1) : fileFwd
}

function shareDownloadHref(
  token: string,
  viewingPath: string,
  ctx: TextViewerShareContext,
): string {
  if (!ctx.isDirectory) {
    return `/api/share/${encodeURIComponent(token)}/download`
  }
  const rel = shareEditRelativePath(viewingPath, ctx)
  if (!rel || rel === '.') {
    return `/api/share/${encodeURIComponent(token)}/download`
  }
  return `/api/share/${encodeURIComponent(token)}/download?path=${encodeURIComponent(rel)}`
}

function buildResolveImageUrl(
  viewingPath: string,
  share: TextViewerShareContext | null,
  knowledgeBases: string[],
): (src: string) => string | null {
  return (rawSrc: string) => {
    let src = rawSrc
    try {
      src = decodeURIComponent(src)
    } catch {
      /* noop */
    }

    if (share) {
      if (src.startsWith('http://') || src.startsWith('https://')) return src
      const fileDir = viewingPath.replace(/\\/g, '/').replace(/\/[^/]*$/, '')
      const shareRoot = share.sharePath.replace(/\\/g, '/')
      const firstSeg = (p: string) => p.split('/').filter(Boolean)[0] ?? ''
      const isAbsolute =
        src.startsWith('/') ||
        (fileDir && (src === fileDir || src.startsWith(fileDir + '/'))) ||
        (shareRoot && (src === shareRoot || src.startsWith(shareRoot + '/'))) ||
        (firstSeg(src) && firstSeg(src) === firstSeg(viewingPath))
      let resolvedPath = isAbsolute
        ? src.startsWith('/')
          ? src.slice(1)
          : src
        : `${fileDir ? fileDir + '/' : ''}${src}`.replace(/\/+/g, '/').replace(/^\/+/, '')
      if (share.isDirectory && shareRoot && resolvedPath.startsWith(shareRoot + '/')) {
        resolvedPath = resolvedPath.slice(shareRoot.length).replace(/^\/+/, '')
      } else if (share.isDirectory && shareRoot && resolvedPath === shareRoot) {
        return null
      } else if (!share.isDirectory && resolvedPath !== shareRoot) {
        return null
      }
      const encoded = resolvedPath
        .split('/')
        .filter(Boolean)
        .map((s) => encodeURIComponent(s))
        .join('/')
      return encoded ? `/api/share/${share.token}/media/${encoded}` : null
    }

    if (!src.startsWith('http://') && !src.startsWith('https://') && !src.includes('/')) {
      const kbRoot = getKnowledgeBaseRoot(viewingPath.replace(/\\/g, '/'), knowledgeBases)
      if (kbRoot) {
        src = `${kbRoot}/images/${src}`
      }
    }

    return `/api/media/${src.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`
  }
}

export function TextViewerBody(props: {
  viewingPath: string
  shareContext?: TextViewerShareContext | null
  editableFolders: string[]
  shareCanEdit: boolean
  knowledgeBases?: string[]
}): JSX.Element {
  const queryClient = useQueryClient()

  const sharePrefsKey = createMemo(() => {
    const ctx = props.shareContext
    if (!ctx) return ''
    if (!ctx.isDirectory) return `share-autosave-${ctx.token}`
    return `share-autosave-${ctx.token}-${props.viewingPath.replace(/[/\\]/g, '_')}`
  })

  const shareTextDefaults = createMemo((): ShareTextViewerSettings => {
    if (!props.shareContext) return { enabled: true, readOnly: false }
    return { enabled: true, readOnly: !props.shareCanEdit }
  })

  const [sharePrefsTick, setSharePrefsTick] = createSignal(0)
  const sharePrefs = createMemo(() => {
    void sharePrefsTick()
    return getShareTextViewerSettings(sharePrefsKey(), shareTextDefaults())
  })

  createEffect(() => {
    migrateLegacyShareTextViewerKey(sharePrefsKey(), shareTextDefaults())
  })

  const settingsQuery = useQuery(() => ({
    queryKey: queryKeys.settings(),
    queryFn: () => api<GlobalSettings>('/api/settings'),
    staleTime: Infinity,
    enabled: !props.shareContext,
  }))

  const autoSaveMutation = useMutation(() => ({
    mutationFn: (vars: { filePath: string; enabled: boolean; readOnly?: boolean }) =>
      post('/api/settings/autoSave', vars),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.settings() })
      const prev = queryClient.getQueryData<GlobalSettings>(queryKeys.settings())
      queryClient.setQueryData<GlobalSettings>(queryKeys.settings(), (old) => {
        if (!old)
          return {
            viewModes: {},
            favorites: [],
            knowledgeBases: [],
            customIcons: {},
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
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
    },
  }))

  const mediaUrl = createMemo(() => {
    const path = props.viewingPath
    const ctx = props.shareContext
    return ctx ? buildShareMediaUrl(ctx.token, ctx.sharePath, path) : buildAdminMediaUrl(path)
  })

  const queryKey = createMemo(() => {
    const ctx = props.shareContext
    return ctx
      ? queryKeys.shareText(ctx.token, props.viewingPath)
      : queryKeys.textContent(props.viewingPath)
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
    if (props.shareContext) return props.shareCanEdit
    return isPathEditable(props.viewingPath, props.editableFolders)
  })

  const autoSaveEnabled = createMemo(() => {
    if (props.shareContext) return sharePrefs().enabled
    const s = settingsQuery.data?.autoSave?.[props.viewingPath]
    return s?.enabled ?? true
  })

  const persistedReadOnly = createMemo(() => {
    if (props.shareContext) return sharePrefs().readOnly
    return settingsQuery.data?.autoSave?.[props.viewingPath]?.readOnly ?? false
  })

  const ext = createMemo(() => props.viewingPath.split('.').pop()?.toLowerCase() || '')
  const isMarkdown = createMemo(() => ext() === 'md')

  const [readOnlyView, setReadOnlyView] = createSignal(false)
  const [editContent, setEditContent] = createSignal('')
  const [copied, setCopied] = createSignal(false)
  const [autoSaveError, setAutoSaveError] = createSignal<string | null>(null)

  let lastPath = ''
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null

  const saveMutation = useMutation(() => ({
    mutationFn: async (content: string) => {
      const ctx = props.shareContext
      if (ctx) {
        const rel = shareEditRelativePath(props.viewingPath, ctx)
        await post(`/api/share/${ctx.token}/edit`, { path: rel, content })
      } else {
        await post('/api/files/edit', { path: props.viewingPath, content })
      }
      return content
    },
    onSuccess: (content: string) => {
      const key = queryKey()
      queryClient.setQueryData(key, content)
      void queryClient.invalidateQueries({ queryKey: key })
    },
  }))

  async function saveInternal(quiet: boolean) {
    if (quiet && editContent() === (textQuery.data ?? '')) return
    if (!quiet) setAutoSaveError(null)
    try {
      await saveMutation.mutateAsync(editContent())
      if (quiet) setAutoSaveError(null)
    } catch (e) {
      if (quiet) {
        setAutoSaveError(e instanceof Error ? e.message : 'Failed to save file')
        window.setTimeout(() => setAutoSaveError(null), 5000)
      } else {
        window.alert(e instanceof Error ? e.message : 'Failed to save file')
      }
    }
  }

  createEffect(() => {
    const path = props.viewingPath
    const data = textQuery.data
    const pr = persistedReadOnly()
    if (!path || data === undefined) return
    if (path !== lastPath) {
      lastPath = path
      setReadOnlyView(pr)
      setEditContent(data)
    }
  })

  createEffect(() => {
    onCleanup(() => {
      if (autosaveTimer) {
        clearTimeout(autosaveTimer)
        autosaveTimer = null
      }
    })
    if (!fileEditable() || readOnlyView() || !autoSaveEnabled()) return
    if (editContent() === (textQuery.data ?? '')) return
    autosaveTimer = setTimeout(() => {
      void saveInternal(true)
    }, 2000)
  })

  async function handleClose() {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer)
      autosaveTimer = null
    }
    if (
      fileEditable() &&
      !readOnlyView() &&
      autoSaveEnabled() &&
      editContent() !== (textQuery.data ?? '')
    ) {
      await saveInternal(true)
    }
    closeViewer()
  }

  function toggleAutoSave() {
    if (props.shareContext) {
      const key = sharePrefsKey()
      const p = sharePrefs()
      setShareTextViewerSettings(key, { enabled: !p.enabled, readOnly: p.readOnly })
      setSharePrefsTick((n) => n + 1)
    } else {
      autoSaveMutation.mutate({ filePath: props.viewingPath, enabled: !autoSaveEnabled() })
    }
  }

  function toggleReadOnlyFromEditor() {
    setReadOnlyView(true)
    if (props.shareContext) {
      const key = sharePrefsKey()
      const p = sharePrefs()
      setShareTextViewerSettings(key, { enabled: p.enabled, readOnly: true })
      setSharePrefsTick((n) => n + 1)
    } else {
      autoSaveMutation.mutate({
        filePath: props.viewingPath,
        enabled: autoSaveEnabled(),
        readOnly: true,
      })
    }
  }

  function enterEditMode() {
    setReadOnlyView(false)
    setEditContent(textQuery.data ?? '')
    if (props.shareContext) {
      const key = sharePrefsKey()
      const p = sharePrefs()
      setShareTextViewerSettings(key, { enabled: p.enabled, readOnly: false })
      setSharePrefsTick((n) => n + 1)
    } else {
      autoSaveMutation.mutate({
        filePath: props.viewingPath,
        enabled: autoSaveEnabled(),
        readOnly: false,
      })
    }
  }

  async function handleCopy() {
    const src = textQuery.data ?? ''
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
    buildResolveImageUrl(props.viewingPath, props.shareContext ?? null, kbList()),
  )

  const fileName = createMemo(() => props.viewingPath.split(/[/\\]/).pop() || '')
  const showEditor = createMemo(() => fileEditable() && !readOnlyView())
  const lineCount = createMemo(() => (textQuery.data ?? '').split('\n').length)
  const shareDownload = createMemo(() => {
    const ctx = props.shareContext
    if (!ctx) return null
    return shareDownloadHref(ctx.token, props.viewingPath, ctx)
  })

  return (
    <div
      role='dialog'
      aria-modal='true'
      aria-labelledby='text-viewer-title'
      class='fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm'
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
                  <span
                    class='text-destructive inline-flex items-center gap-1 text-xs'
                    title={autoSaveError() ?? ''}
                  >
                    <AlertCircle class='h-4 w-4 shrink-0' stroke-width={2} />
                    Save failed
                  </span>
                </Show>
              </div>
            </Show>
            <button
              type='button'
              class='hover:bg-muted rounded-md px-2 py-1 text-sm disabled:opacity-50'
              disabled={saveMutation.isPending}
              onClick={() => toggleReadOnlyFromEditor()}
              title='Switch to read-only mode'
            >
              Read only
            </button>
            <Show when={!autoSaveEnabled()}>
              <button
                type='button'
                class='bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm disabled:opacity-50'
                disabled={saveMutation.isPending}
                onClick={() => void saveInternal(false)}
                title='Save changes'
              >
                <Save class='h-4 w-4' stroke-width={2} />
                {saveMutation.isPending ? 'Saving…' : 'Save'}
              </button>
            </Show>
            <Show when={autoSaveEnabled() && !saveMutation.isPending && saveMutation.isError}>
              <span class='text-destructive text-xs'>Save failed</span>
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
          <Show when={shareDownload()}>
            <button
              type='button'
              title='Download'
              aria-label='Download'
              class='hover:bg-muted inline-flex h-8 w-8 items-center justify-center rounded-md'
              onClick={() => {
                const h = shareDownload()
                if (!h) return
                const a = document.createElement('a')
                a.href = h
                a.download = fileName()
                a.click()
              }}
            >
              <Download class='h-5 w-5' stroke-width={2} aria-hidden='true' />
            </button>
          </Show>
          <button
            type='button'
            title='Close'
            class='hover:bg-muted inline-flex h-8 w-8 items-center justify-center rounded-md'
            onClick={() => void handleClose()}
          >
            <span class='sr-only'>Close</span>×
          </button>
        </div>
      </header>
      <div class='min-h-0 flex-1 overflow-hidden'>
        <Show when={textQuery.isPending}>
          <p class='text-muted-foreground p-4 text-sm'>Loading…</p>
        </Show>
        <Show when={textQuery.isError}>
          <p class='text-destructive p-4 text-sm'>Failed to load file.</p>
        </Show>
        <Show when={!textQuery.isPending && !textQuery.isError}>
          <Show
            when={showEditor()}
            fallback={
              <Show
                when={isMarkdown()}
                fallback={
                  <div class='h-full overflow-auto p-4'>
                    <pre class='font-mono text-sm wrap-break-word whitespace-pre-wrap'>
                      {textQuery.data ?? ''}
                    </pre>
                  </div>
                }
              >
                <MarkdownPane content={textQuery.data ?? ''} resolveImageUrl={resolveImageUrl()} />
              </Show>
            }
          >
            <div class='h-full p-4'>
              <textarea
                class='border-input bg-background focus-visible:ring-ring h-full w-full resize-none rounded-lg border p-4 font-mono text-sm focus-visible:ring-2 focus-visible:outline-none'
                value={editContent()}
                spellcheck={false}
                placeholder='Enter text…'
                onInput={(e) => setEditContent(e.currentTarget.value)}
                onBlur={() => {
                  if (autoSaveEnabled()) void saveInternal(true)
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
        </Show>
      </div>
    </div>
  )
}

export function TextViewerDialog(props: Props) {
  const history = useBrowserHistory()

  const viewingPath = createMemo(() => {
    const sp = new URLSearchParams(history().search)
    return sp.get('viewing')
  })

  const extension = createMemo(() => (viewingPath() || '').split('.').pop()?.toLowerCase() || '')
  const mediaType = createMemo(() => getMediaType(extension()))
  const isText = createMemo(() => !!viewingPath() && mediaType() === MediaType.TEXT)

  const folders = () => props.editableFolders ?? []
  const kb = () => props.knowledgeBases ?? []
  const shareEdit = () => props.shareCanEdit ?? false

  return (
    <Show when={viewingPath() && isText()}>
      <TextViewerBody
        viewingPath={viewingPath()!}
        shareContext={props.shareContext ?? null}
        editableFolders={folders()}
        knowledgeBases={kb()}
        shareCanEdit={shareEdit()}
      />
    </Show>
  )
}
