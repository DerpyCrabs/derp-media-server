import { getMediaType } from '@/lib/media-utils'
import { MediaType } from '@/lib/types'
import { stripSharePrefix } from '@/lib/source-context'
import Download from 'lucide-solid/icons/download'
import ExternalLink from 'lucide-solid/icons/external-link'
import X from 'lucide-solid/icons/x'
import { Show, createMemo } from 'solid-js'
import { createUrlSearchParamsMemo, useBrowserHistory } from '../browser-history'
import { buildAdminMediaUrl, buildShareMediaUrl } from '../lib/build-media-url'
import { closeViewer } from '../lib/url-state-actions'

type Props = {
  shareContext?: { token: string; sharePath: string } | null
}

export function PdfViewerDialog(props: Props) {
  const history = useBrowserHistory()
  const urlSearchParams = createUrlSearchParamsMemo(history)

  const viewingPath = createMemo(() => urlSearchParams().get('viewing'))

  const extension = createMemo(() => (viewingPath() || '').split('.').pop()?.toLowerCase() || '')
  const isPdf = createMemo(() => !!viewingPath() && getMediaType(extension()) === MediaType.PDF)

  const ctx = () => props.shareContext

  const mediaUrl = createMemo(() => {
    const path = viewingPath()
    if (!path) return ''
    const c = ctx()
    return c ? buildShareMediaUrl(c.token, c.sharePath, path) : buildAdminMediaUrl(path)
  })

  const downloadHref = createMemo(() => {
    const path = viewingPath()
    if (!path) return ''
    const c = ctx()
    if (c) {
      const relative = stripSharePrefix(path, c.sharePath)
      return `/api/share/${c.token}/download?path=${encodeURIComponent(relative || '.')}`
    }
    return `/api/files/download?path=${encodeURIComponent(path)}`
  })

  const fileName = createMemo(() => (viewingPath() || '').split(/[/\\]/).pop() || '')

  return (
    <Show when={viewingPath() && isPdf()}>
      <div role='dialog' aria-modal='true' class='fixed inset-0 z-50 flex flex-col bg-black/95'>
        <div class='flex items-center justify-between bg-black/50 p-4 backdrop-blur-sm'>
          <div class='flex-1'>
            <h2 class='max-w-md truncate text-lg font-medium text-white'>{fileName()}</h2>
          </div>
          <div class='flex flex-1 items-center justify-end gap-2'>
            <button
              type='button'
              title='Open in new tab'
              class='inline-flex h-9 w-9 items-center justify-center rounded-md text-white hover:bg-white/10'
              onClick={() => {
                const url = mediaUrl()
                if (url) window.open(url, '_blank')
              }}
            >
              <ExternalLink class='h-5 w-5' size={20} stroke-width={2} />
            </button>
            <button
              type='button'
              title='Download'
              class='inline-flex h-9 w-9 items-center justify-center rounded-md text-white hover:bg-white/10'
              onClick={() => {
                const link = document.createElement('a')
                link.href = downloadHref()
                link.download = fileName()
                document.body.appendChild(link)
                link.click()
                document.body.removeChild(link)
              }}
            >
              <Download class='h-5 w-5' size={20} stroke-width={2} />
            </button>
            <div class='mx-2 h-6 w-px bg-white/20' />
            <button
              type='button'
              title='Close'
              class='inline-flex h-9 w-9 items-center justify-center rounded-md text-white hover:bg-white/10'
              onClick={() => closeViewer()}
            >
              <X class='h-5 w-5' size={20} stroke-width={2} />
            </button>
          </div>
        </div>
        <div class='flex flex-1 items-center justify-center overflow-hidden bg-neutral-800'>
          <embed
            src={mediaUrl() ? `${mediaUrl()}#toolbar=1` : ''}
            type='application/pdf'
            class='h-full w-full'
            title={fileName()}
          />
        </div>
      </div>
    </Show>
  )
}
