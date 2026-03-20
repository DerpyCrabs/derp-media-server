import { useEffect, useRef } from 'react'
import { useUrlState } from '@/lib/use-url-state'
import { useTheme } from '@/lib/use-theme'
import * as icons from 'lucide-static'
import type { NavigationState } from '@/lib/navigation-session'

// Default favicon as data URL - avoids favicon.ico requests on every pushState (Chrome behavior)
const DEFAULT_FAVICON_DATA_URL =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23fff' stroke-width='2'><path d='M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z'/></svg>"

// Convert icon name to match lucide-static format
function getIconSvg(iconName: string): string | null {
  const iconKey = iconName as keyof typeof icons
  if (iconKey in icons) {
    return icons[iconKey]
  }
  return null
}

// Generate a favicon from an SVG string
async function generateFaviconFromSvg(
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
  // Replace currentColor with the theme color
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

// Set or update the favicon
function setFavicon(href: string) {
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

export function useDynamicFavicon(
  customIcons: Record<string, string>,
  options?: { rootName?: string; state?: NavigationState },
) {
  const { state: urlState } = useUrlState()
  const { resolved: theme } = useTheme()
  const navigationState = options?.state ?? urlState
  const originalTitleRef = useRef<string>('Media Server')
  const originalFaviconRef = useRef<string | null>(null)
  const currentFaviconRef = useRef<string>('default')

  useEffect(() => {
    // Store original title and favicon on first mount
    if (originalTitleRef.current === 'Media Server') {
      originalTitleRef.current = document.title
      const existingFavicon = document.querySelector("link[rel*='icon']") as HTMLLinkElement
      originalFaviconRef.current = existingFavicon?.href ?? DEFAULT_FAVICON_DATA_URL
    }
  }, [])

  useEffect(() => {
    const currentDir = navigationState.dir || ''
    const playingPath = navigationState.playing
    const viewingPath = navigationState.viewing

    // Determine what to show: file being played/viewed, or current directory
    let targetPath = currentDir
    let shouldUpdateFavicon = false

    // Priority: playing/viewing files with custom icons
    if (playingPath && customIcons[playingPath]) {
      targetPath = playingPath
      shouldUpdateFavicon = true
    } else if (viewingPath && customIcons[viewingPath]) {
      targetPath = viewingPath
      shouldUpdateFavicon = true
    } else if (customIcons[currentDir]) {
      targetPath = currentDir
      shouldUpdateFavicon = true
    }

    // Set title to current directory name (use rootName for share view when at root)
    const folderName = currentDir ? currentDir.split(/[/\\]/).pop() : (options?.rootName ?? 'Home')
    document.title = folderName ? `${folderName} - Media Server` : 'Media Server'

    // Only update favicon when the desired state actually changes
    if (shouldUpdateFavicon) {
      const customIconName = customIcons[targetPath]
      const svgString = getIconSvg(customIconName)
      if (svgString) {
        const isDark = document.documentElement.getAttribute('data-theme')?.endsWith('-dark')
        const color = isDark ? '#ffffff' : '#000000'

        void generateFaviconFromSvg(svgString, color).then((data) => {
          if (data && data !== currentFaviconRef.current) {
            setFavicon(data)
            currentFaviconRef.current = data
          }
        })
      } else if (currentFaviconRef.current !== 'default') {
        const defaultHref = originalFaviconRef.current ?? DEFAULT_FAVICON_DATA_URL
        setFavicon(defaultHref)
        currentFaviconRef.current = 'default'
      }
    } else {
      // Only reset to default if we're not already showing it
      if (currentFaviconRef.current !== 'default') {
        const defaultHref = originalFaviconRef.current ?? DEFAULT_FAVICON_DATA_URL
        setFavicon(defaultHref)
        currentFaviconRef.current = 'default'
      }
    }

    return () => {
      // Cleanup: restore default only when we had a custom icon
      if (shouldUpdateFavicon && currentFaviconRef.current !== 'default') {
        const defaultHref = originalFaviconRef.current ?? DEFAULT_FAVICON_DATA_URL
        setFavicon(defaultHref)
        currentFaviconRef.current = 'default'
      }
    }
  }, [
    navigationState.dir,
    navigationState.playing,
    navigationState.viewing,
    customIcons,
    options?.rootName,
    theme,
  ])
}
