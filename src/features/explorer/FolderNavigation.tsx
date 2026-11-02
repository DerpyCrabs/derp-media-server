import { Button } from '@/lib/ui/button'
import { view } from 'effectweb'
import ArrowLeft from '@effectweb/lucide/icons/arrow-left'
import ArrowRight from '@effectweb/lucide/icons/arrow-right'
export type FolderNavigationActions = {
  canBack: boolean
  canForward: boolean
  back: () => void
  forward: () => void
}
export const FolderNavigation = view<FolderNavigationActions>((props) => (
  <div class='flex shrink-0 items-center' aria-label='Folder navigation'>
    <Button
      size='icon'
      variant='ghost'
      type='button'
      aria-label='Back to previous folder'
      title='Back (Alt+Left)'
      disabled={!props.canBack}
      class='inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30'
      onClick={(event) => {
        event.currentTarget.closest<HTMLElement>('[data-folder-navigation]')?.focus()
        props.back()
      }}
    >
      <ArrowLeft class='size-3.5' />
    </Button>
    <Button
      size='icon'
      variant='ghost'
      type='button'
      aria-label='Forward to next folder'
      title='Forward (Alt+Right)'
      disabled={!props.canForward}
      class='inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30'
      onClick={(event) => {
        event.currentTarget.closest<HTMLElement>('[data-folder-navigation]')?.focus()
        props.forward()
      }}
    >
      <ArrowRight class='size-3.5' />
    </Button>
  </div>
))
