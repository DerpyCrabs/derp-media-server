import { For } from 'solid-js'
import type { Setter } from 'solid-js'
import type { JSX } from '@solidjs/web'
import { DEFAULT_BOOK_APPEARANCE, type BookAppearance } from './reader-state-client'

export function ReaderSetting(props: { label: string; children: JSX.Element }) {
  return (
    <section class='grid gap-[5px]'>
      <h2 class='text-xs font-semibold text-white/60'>{props.label}</h2>
      {props.children}
    </section>
  )
}

export function Segmented(props: {
  values: readonly string[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div class='flex min-h-8 gap-[3px] rounded-lg bg-[#2a2a2a] p-0.5'>
      <For each={props.values}>
        {(value) => (
          <button
            type='button'
            class={[
              'min-w-0 flex-1 rounded-md border border-transparent px-2 py-1 text-xs capitalize hover:border-[#777]',
              {
                'border-[#7a7a7a] bg-[#303030] text-white': props.value === value,
                'text-white/60': props.value !== value,
              },
            ]}
            onClick={() => props.onChange(value)}
          >
            {value}
          </button>
        )}
      </For>
    </div>
  )
}

function StepSetting(props: { value: string; onDecrease: () => void; onIncrease: () => void }) {
  return (
    <div class='grid grid-cols-[32px_minmax(82px,1fr)_32px] items-center'>
      <button
        type='button'
        aria-label='Decrease'
        class='h-8 rounded-md border border-[#3a3a3a] bg-[#202020] hover:border-[#777]'
        onClick={() => props.onDecrease()}
      >
        −
      </button>
      <span class='text-center text-xs text-white/70'>{props.value}</span>
      <button
        type='button'
        aria-label='Increase'
        class='h-8 rounded-md border border-[#3a3a3a] bg-[#202020] hover:border-[#777]'
        onClick={() => props.onIncrease()}
      >
        +
      </button>
    </div>
  )
}

export function BookAppearanceSettings(props: {
  value: BookAppearance
  onChange: Setter<BookAppearance>
}) {
  const update = (next: Partial<BookAppearance>) =>
    props.onChange((current) => ({ ...current, ...next }))
  const adjust = (
    key: 'fontScale' | 'lineHeight' | 'contentWidth',
    amount: number,
    fallback: number,
  ) => {
    const bounds = {
      fontScale: [0.5, 3],
      lineHeight: [0.8, 3],
      contentWidth: [20, 100],
    } as const
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
      <ReaderSetting label='Content width'>
        <StepSetting
          value={props.value.contentWidth === null ? 'Publisher' : `${props.value.contentWidth}rem`}
          onDecrease={() => adjust('contentWidth', -4, 48)}
          onIncrease={() => adjust('contentWidth', 4, 48)}
        />
      </ReaderSetting>
      <button
        type='button'
        class='h-8 rounded-md border border-[#3a3a3a] bg-[#202020] text-xs hover:border-[#777]'
        onClick={() => props.onChange({ ...DEFAULT_BOOK_APPEARANCE })}
      >
        Reset appearance
      </button>
    </>
  )
}
