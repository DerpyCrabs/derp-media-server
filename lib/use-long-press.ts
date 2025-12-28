'use client'

import { useRef, useCallback } from 'react'

interface UseLongPressOptions {
  onLongPress: (e: React.TouchEvent | React.MouseEvent | React.PointerEvent) => void
  delay?: number
}

export function useLongPress({ onLongPress, delay = 500 }: UseLongPressOptions) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const targetRef = useRef<EventTarget | null>(null)

  const start = useCallback(
    (e: React.TouchEvent | React.MouseEvent | React.PointerEvent) => {
      // Only handle primary mouse button or touch
      if ('button' in e && e.button !== 0) return

      targetRef.current = e.target
      timeoutRef.current = setTimeout(() => {
        onLongPress(e)
      }, delay)
    },
    [onLongPress, delay],
  )

  const clear = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    targetRef.current = null
  }, [])

  return {
    onPointerDown: start,
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
  }
}
