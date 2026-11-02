import { Button } from '@/lib/ui/button'
import { cn } from '@/lib/ui/cn'
import { view, list, type JSX } from 'effectweb'
import { DEFAULT_BOOK_APPEARANCE, type BookAppearance } from './reader-state-client'
export const ReaderSetting = view<{ label: string; children: JSX.Element }>((props) => {
  return (
    <section class='grid gap-[5px]'>
      <h2 class='text-xs font-semibold text-muted-foreground'>{props.label}</h2>
      {props.children}
    </section>
  )
})
export const Segmented = view<{
  values: readonly string[]
  value: string
  onChange: (value: string) => void
}>((props) => {
  return (
    <div class='flex min-h-8 gap-0.5 rounded-lg bg-muted p-0.5'>
      {list(
        props.values,
        (value) => value,
        (value) => (
          <Button
            variant='ghost'
            aria-pressed={props.value === value}
            type='button'
            class={cn('min-w-0 flex-1 rounded-md px-2 py-1 text-xs capitalize', {
              'bg-background text-foreground shadow-sm': props.value === value,
              'text-muted-foreground': props.value !== value,
            })}
            onClick={() => props.onChange(value)}
          >
            {value}
          </Button>
        ),
      )}
    </div>
  )
})
const StepSetting = view<{ value: string; onDecrease: () => void; onIncrease: () => void }>(
  (props) => {
    return (
      <div class='grid grid-cols-[32px_minmax(82px,1fr)_32px] items-center'>
        <Button
          size='icon'
          variant='outline'
          type='button'
          aria-label='Decrease'
          class='h-8 rounded-md border border-border bg-background hover:border-border'
          onClick={() => props.onDecrease()}
        >
          −
        </Button>
        <span class='text-center text-xs text-muted-foreground'>{props.value}</span>
        <Button
          size='icon'
          variant='outline'
          type='button'
          aria-label='Increase'
          class='h-8 rounded-md border border-border bg-background hover:border-border'
          onClick={() => props.onIncrease()}
        >
          +
        </Button>
      </div>
    )
  },
)
export const BookAppearanceSettings = view<{
  value: BookAppearance
  onChange: (value: BookAppearance) => void
}>((props) => {
  const update = (next: Partial<BookAppearance>) => props.onChange({ ...props.value, ...next })
  const adjust = (key: 'fontScale' | 'lineHeight', amount: number, fallback: number) => {
    const bounds = { fontScale: [0.5, 3], lineHeight: [0.8, 3] } as const
    const [minimum, maximum] = bounds[key]
    const value = Math.max(minimum, Math.min(maximum, (props.value[key] ?? fallback) + amount))
    update({ [key]: Number(value.toFixed(2)) })
  }
  return (
    <>
      <ReaderSetting label='Font'>
        <Segmented
          values={['publisher', 'serif', 'sans']}
          value={props.value.fontFamily}
          onChange={(value) => update({ fontFamily: value as BookAppearance['fontFamily'] })}
        />
      </ReaderSetting>
      <ReaderSetting label='Theme'>
        <Segmented
          values={['publisher', 'light', 'dark', 'sepia']}
          value={props.value.theme}
          onChange={(value) => update({ theme: value as BookAppearance['theme'] })}
        />
      </ReaderSetting>
      <ReaderSetting label='Font size'>
        <StepSetting
          value={
            props.value.fontScale === null
              ? 'Publisher'
              : `${Math.round(props.value.fontScale * 100)}%`
          }
          onDecrease={() => adjust('fontScale', -0.1, 1)}
          onIncrease={() => adjust('fontScale', 0.1, 1)}
        />
      </ReaderSetting>
      <ReaderSetting label='Line height'>
        <StepSetting
          value={props.value.lineHeight === null ? 'Publisher' : props.value.lineHeight.toFixed(2)}
          onDecrease={() => adjust('lineHeight', -0.1, 1.65)}
          onIncrease={() => adjust('lineHeight', 0.1, 1.65)}
        />
      </ReaderSetting>
      <ReaderSetting label='Page width'>
        <Segmented
          values={['narrow', 'wide', 'full']}
          value={props.value.contentWidth}
          onChange={(value) => update({ contentWidth: value as BookAppearance['contentWidth'] })}
        />
      </ReaderSetting>
      <Button
        variant='outline'
        type='button'
        class='h-8 rounded-md border border-border bg-background text-xs hover:border-border'
        onClick={() => props.onChange({ ...DEFAULT_BOOK_APPEARANCE })}
      >
        Reset appearance
      </Button>
    </>
  )
})
