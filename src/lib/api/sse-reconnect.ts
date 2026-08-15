const INITIAL_DELAY_MS = 5000
const MAX_DELAY_MS = 60000
const BACKOFF_MULTIPLIER = 2

function getDelayMs(retryCount: number): number {
  const delay = INITIAL_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, retryCount)
  return Math.min(delay, MAX_DELAY_MS)
}

function isTabVisible(): boolean {
  return typeof document !== 'undefined' && !document.hidden
}

/**
 * Schedules SSE reconnection with exponential backoff.
 * Pauses reconnection attempts when tab is hidden to save resources.
 * Resumes when tab becomes visible again.
 */
export function createReconnectScheduler(connect: () => void): {
  schedule: () => void
  cleanup: () => void
} {
  let retryCount = 0
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const schedule = () => {
    if (timeoutId) return
    if (!isTabVisible()) return
    const delay = getDelayMs(retryCount)
    retryCount++
    timeoutId = setTimeout(() => {
      timeoutId = null
      if (isTabVisible()) connect()
    }, delay)
  }

  const cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  const reset = () => {
    cancel()
    retryCount = 0
  }

  const handleVisibilityChange = () => {
    if (isTabVisible()) {
      reset()
      connect()
    } else {
      cancel()
    }
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange)
  }

  const cleanup = () => {
    cancel()
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }

  return { schedule, cleanup }
}
