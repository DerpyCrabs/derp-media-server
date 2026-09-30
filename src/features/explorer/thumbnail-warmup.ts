import { MediaType, type FileItem } from '@/lib/files/types'
import { buildThumbnailUrl } from '@/lib/media/build-media-url'
import { observeMediaVisibility, createMediaWarmup } from '@/lib/media/media-warmup'
export function mountThumbnailWarmup(target: HTMLElement, files: () => readonly FileItem[]) {
  const warmup = createMediaWarmup()
  let visible = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const update = () => {
    if (!visible) {
      warmup.select([])
      return
    }
    const top = Math.max(0, target.getBoundingClientRect().top)
    const row = Array.from(target.querySelectorAll<HTMLElement>('[data-file-path]')).find(
      (row) => row.getBoundingClientRect().bottom > top,
    )
    const rows = files()
    const index = Math.max(
      0,
      rows.findIndex((file) => file.path === row?.dataset.filePath),
    )
    const urls: string[] = []
    const add = (file: FileItem | undefined) => {
      if (
        file &&
        !file.isDirectory &&
        !file.thumbnailGenerated &&
        (file.type === MediaType.IMAGE || file.type === MediaType.VIDEO)
      )
        urls.push(
          buildThumbnailUrl(file.path, file.version).replace(
            '/api/thumbnail/',
            '/api/warm/thumbnail/',
          ),
        )
    }
    add(rows[index])
    for (let distance = 1; distance < Math.max(index + 1, rows.length - index); distance++) {
      add(rows[index + distance])
      add(rows[index - distance])
    }
    warmup.select(urls)
  }
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(update, 150)
  }
  const stopVisibility = observeMediaVisibility(target, (next) => {
    visible = next
    schedule()
  })
  const observer = new MutationObserver(schedule)
  observer.observe(target, { childList: true, subtree: true })
  document.addEventListener('scroll', schedule, { capture: true, passive: true })
  return () => {
    clearTimeout(timer)
    stopVisibility()
    observer.disconnect()
    warmup.dispose()
    document.removeEventListener('scroll', schedule, true)
  }
}
