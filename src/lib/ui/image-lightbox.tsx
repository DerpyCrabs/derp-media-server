import { view } from 'effectweb'
import { Dialog } from './dialog'

export const ImageLightbox = view<{ src: string; alt: string; onClose: () => void }>((props) => (
  <Dialog
    open
    onOpenChange={(open) => {
      if (!open) props.onClose()
    }}
    aria-label={props.alt || 'View image'}
    class='sm:max-w-[calc(100vw-2rem)] w-fit min-w-24 min-h-24 max-h-[calc(100dvh-2rem)] p-2'
  >
    <img
      src={props.src}
      alt={props.alt}
      draggable={false}
      class='max-h-[calc(100dvh-3rem)] max-w-full object-contain'
    />
  </Dialog>
))
