import TriangleAlert from 'lucide-solid/icons/triangle-alert'

export type ContentRecoveryViewProps = Readonly<{
  reason: string
}>

export function ContentRecoveryView(props: ContentRecoveryViewProps) {
  return (
    <div
      role='alert'
      data-testid='content-recovery'
      class='flex h-full min-h-0 items-center justify-center p-6 text-center'
    >
      <div class='max-w-sm space-y-3'>
        <TriangleAlert class='mx-auto size-8 text-amber-500' aria-hidden='true' />
        <div class='font-medium text-foreground'>Content could not be restored</div>
        <p class='text-sm text-muted-foreground'>{props.reason}</p>
      </div>
    </div>
  )
}
