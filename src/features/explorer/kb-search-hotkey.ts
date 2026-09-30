export function registerKbSearchHotkeys(options: {
  active: () => boolean
  isOpen: () => boolean
  setOpen: (open: boolean) => void
  focusInput: () => void
}) {
  const listener = (event: KeyboardEvent) => {
    if (!options.active()) return
    if (event.key === 'Escape' && options.isOpen()) {
      event.preventDefault()
      options.setOpen(false)
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      options.setOpen(true)
      options.focusInput()
      return
    }
    const target = event.target as HTMLElement | null
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      options.setOpen(true)
      options.focusInput()
    }
  }
  document.addEventListener('keydown', listener)
  return () => document.removeEventListener('keydown', listener)
}
