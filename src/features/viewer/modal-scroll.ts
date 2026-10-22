export const modalScroll = (_element: HTMLDivElement, current: () => boolean) => {
  let restore: (() => void) | undefined
  const update = () => {
    if (current() && !restore) {
      const html = document.documentElement,
        body = document.body
      const previous = { html: html.style.overflow, body: body.style.overflow }
      html.style.overflow = 'hidden'
      body.style.overflow = 'hidden'
      restore = () => {
        html.style.overflow = previous.html
        body.style.overflow = previous.body
      }
    } else if (!current()) {
      restore?.()
      restore = undefined
    }
  }
  update()
  return { update, dispose: () => restore?.() }
}
