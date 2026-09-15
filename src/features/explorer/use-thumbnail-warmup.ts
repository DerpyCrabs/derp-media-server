import { createEffect, createMemo, createSignal, type Accessor } from 'solid-js'
import { MediaType, type FileItem } from '@/lib/files/types'
import { buildThumbnailUrl } from '@/lib/media/build-media-url'
import { createMediaVisibility, createMediaWarmup } from '@/lib/media/media-warmup'

export function useThumbnailWarmup(
  files: Accessor<FileItem[]>,
  element: Accessor<HTMLElement | undefined>,
) {
  const visible = createMediaVisibility(element)
  const [anchor, setAnchor] = createSignal('')
  createEffect(element, (target) => {
    if (!target) return undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const update = () => {
      const top = Math.max(0, target.getBoundingClientRect().top)
      const row = Array.from(target.querySelectorAll<HTMLElement>('[data-file-path]')).find(
        (row) => row.getBoundingClientRect().bottom > top,
      )
      setAnchor(row?.dataset.filePath ?? '')
    }
    const scroll = () => {
      clearTimeout(timer)
      timer = setTimeout(update, 150)
    }
    scroll()
    document.addEventListener('scroll', scroll, { capture: true, passive: true })
    // eslint-disable-next-line solid/reactivity
    return () => {
      clearTimeout(timer)
      document.removeEventListener('scroll', scroll, true)
    }
  })
  const urls = createMemo(() => {
    if (!visible()) return []
    const list = files()
    const index = Math.max(
      0,
      list.findIndex((file) => file.path === anchor()),
    )
    const result: string[] = []
    const add = (file: FileItem | undefined) => {
      if (
        file &&
        !file.isDirectory &&
        !file.thumbnailGenerated &&
        (file.type === MediaType.IMAGE || file.type === MediaType.VIDEO)
      ) {
        result.push(
          buildThumbnailUrl(file.path, file.version).replace(
            '/api/thumbnail/',
            '/api/warm/thumbnail/',
          ),
        )
      }
    }
    add(list[index])
    for (let distance = 1; distance < Math.max(index + 1, list.length - index); distance++) {
      add(list[index + distance])
      add(list[index - distance])
    }
    return result
  })
  createMediaWarmup(urls)
}
