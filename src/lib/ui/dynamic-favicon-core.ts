import { Effect } from 'effect'

export { getAvailableIconSvg as getLucideIconSvg } from './available-icon-svgs'

export const DEFAULT_FAVICON_DATA_URL =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23fff' stroke-width='2'><path d='M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z'/></svg>"

export function generateFaviconFromSvg(svgString: string, color: string = '#ffffff') {
  return Effect.callback<string>((resume) => {
    const canvas = document.createElement('canvas')
    const size = 32
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')

    if (!ctx) return resume(Effect.succeed(''))

    const img = new Image()
    const coloredSvg = svgString
      .replace(/stroke="currentColor"/g, `stroke="${color}"`)
      .replace(/fill="currentColor"/g, `fill="${color}"`)

    const svgBlob = new Blob([coloredSvg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)

    img.onload = () => {
      ctx.clearRect(0, 0, size, size)
      const padding = 4
      ctx.drawImage(img, padding, padding, size - padding * 2, size - padding * 2)
      resume(Effect.sync(() => canvas.toDataURL('image/png')))
    }
    img.onerror = () => {
      resume(Effect.succeed(''))
    }
    img.src = url
    return Effect.sync(() => {
      img.onload = null
      img.onerror = null
      img.src = ''
      URL.revokeObjectURL(url)
    })
  })
}

export function setFaviconHref(href: string) {
  const existingLink = document.querySelector("link[rel*='icon']") as HTMLLinkElement
  if (existingLink) {
    existingLink.href = href
  } else {
    const link = document.createElement('link')
    link.rel = 'icon'
    link.type = 'image/png'
    link.href = href
    document.head.appendChild(link)
  }
}

export type DynamicFaviconNavState = {
  dir: string | null
  viewing: string | null
  playing: string | null
}
