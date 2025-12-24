'use client'

import { useEffect, useRef } from 'react'

interface UseDynamicFaviconProps {
  itemPath?: string | null
  itemName?: string | null
  customIconName?: string | null
  isActive?: boolean
}

export function useDynamicFavicon({
  itemPath,
  itemName,
  customIconName,
  isActive = true,
}: UseDynamicFaviconProps) {
  const originalTitleRef = useRef<string>('Media Server')

  useEffect(() => {
    // Store original title on first mount
    if (originalTitleRef.current === 'Media Server') {
      originalTitleRef.current = document.title
    }
  }, [])

  useEffect(() => {
    if (!isActive || !itemName) {
      // Reset to default
      document.title = originalTitleRef.current
      return
    }

    // Update title only (favicon rendering is complex with React components)
    document.title = `${itemName} - Media Server`

    // Cleanup on unmount or when deps change
    return () => {
      document.title = originalTitleRef.current
    }
  }, [itemPath, itemName, customIconName, isActive])
}
