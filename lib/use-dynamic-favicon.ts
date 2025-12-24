'use client'

import { useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import * as icons from 'lucide-static'

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

export function useDynamicFavicon(customIcons: Record<string, string>) {
  const searchParams = useSearchParams()
  const originalTitleRef = useRef<string>('Media Server')
  const originalFaviconRef = useRef<string>('/favicon.ico')

  useEffect(() => {
    // Store original title and favicon on first mount
    if (originalTitleRef.current === 'Media Server') {
      originalTitleRef.current = document.title
      const existingFavicon = document.querySelector("link[rel*='icon']") as HTMLLinkElement
      if (existingFavicon) {
        originalFaviconRef.current = existingFavicon.href
      }
    }
  }, [])

  useEffect(() => {
    const currentDir = searchParams.get('dir') || ''
    const playingPath = searchParams.get('playing')
    const viewingPath = searchParams.get('viewing')

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

    // Set title to current directory name
    const folderName = currentDir ? currentDir.split(/[/\\]/).pop() : 'Root'
    document.title = folderName ? `${folderName} - Media Server` : 'Media Server'

    // Update favicon if there's a custom icon
    if (shouldUpdateFavicon) {
      const customIconName = customIcons[targetPath]
      const svgString = getIconSvg(customIconName)
      if (svgString) {
        const isDark = document.documentElement.classList.contains('dark')
        const color = isDark ? '#ffffff' : '#000000'

        generateFaviconFromSvg(svgString, color).then((data) => {
          if (data) setFavicon(data)
        })
      }
    } else {
      // Reset to default favicon
      setFavicon(originalFaviconRef.current)
    }

    return () => {
      // Cleanup
      if (shouldUpdateFavicon) {
        setFavicon(originalFaviconRef.current)
      }
    }
  }, [searchParams, customIcons])
}
