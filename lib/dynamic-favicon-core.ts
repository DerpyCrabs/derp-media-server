import * as icons from 'lucide-static'

export const DEFAULT_FAVICON_DATA_URL =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23fff' stroke-width='2'><path d='M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z'/></svg>"

export function getLucideIconSvg(iconName: string): string | null {
  const iconKey = iconName as keyof typeof icons
  if (iconKey in icons) {
    return icons[iconKey]
  }
  return null
}

export async function generateFaviconFromSvg(
  svgString: string,
  color: string = '#ffffff',
): Promise<string> {
  const canvas = document.createElement('canvas')
  const size = 32
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  if (!ctx) return ''

  const img = new Image()
  const coloredSvg = svgString
    .replace(/stroke="currentColor"/g, `stroke="${color}"`)
    .replace(/fill="currentColor"/g, `fill="${color}"`)

  const svgBlob = new Blob([coloredSvg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)

  return new Promise<string>((resolve) => {
    img.onload = () => {
      ctx.clearRect(0, 0, size, size)
      const padding = 4
      ctx.drawImage(img, padding, padding, size - padding * 2, size - padding * 2)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve('')
    }
    img.src = url
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
