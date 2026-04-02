import {
  type LayoutPreviewGroup,
  type LayoutPreviewGroupSplit,
  type LayoutPreviewGroupTabs,
  computeLayoutPreviewDetail,
} from '@/lib/workspace-layout-preview'
import type { PersistedWorkspaceState } from '@/lib/use-workspace'
import Pin from 'lucide-solid/icons/pin'
import { For, Show, createMemo, type ParentProps } from 'solid-js'

const PREVIEW_WIDTH_PX = 240

function TabStrip(props: {
  tabs: { id: string; label: string; pinned: boolean }[]
  dense?: boolean
}) {
  return (
    <div
      class='flex min-h-0 shrink-0 flex-row gap-px overflow-hidden border-b border-border bg-muted/90'
      classList={{ 'max-h-[26%]': !props.dense, 'max-h-[40%]': !!props.dense }}
    >
      <Show when={props.tabs.length === 0}>
        <span class='flex min-h-[14px] min-w-0 flex-1 items-center justify-center bg-secondary/50 px-0.5 text-[8px] text-muted-foreground'>
          —
        </span>
      </Show>
      <For each={props.tabs}>
        {(t) => (
          <span
            class='flex min-w-0 flex-1 items-center justify-center gap-0.5 truncate border-r border-border/70 bg-secondary/80 px-0.5 py-px text-[8px] leading-snug text-foreground'
            title={t.pinned ? `Pinned tab: ${t.label}` : t.label}
          >
            <Show when={t.pinned}>
              <Pin
                class='size-2 shrink-0 text-amber-600 dark:text-amber-400'
                stroke-width={2.5}
                aria-hidden
              />
            </Show>
            <span class='min-w-0 truncate'>{t.label}</span>
          </span>
        )}
      </For>
    </div>
  )
}

function PreviewGroupShell(props: ParentProps<{ group: LayoutPreviewGroup }>) {
  return (
    <div
      class='absolute box-border flex h-full w-full flex-col overflow-hidden rounded-sm border border-foreground/25 bg-card shadow-sm'
      classList={{
        'opacity-[0.58]': props.group.minimized,
        'ring-1 ring-dashed ring-muted-foreground/40': props.group.minimized,
      }}
      style={{
        left: `${props.group.leftPct}%`,
        top: `${props.group.topPct}%`,
        width: `${props.group.widthPct}%`,
        height: `${props.group.heightPct}%`,
        'z-index': props.group.z,
      }}
    >
      <Show when={props.group.minimized}>
        <div class='shrink-0 truncate border-b border-border/60 bg-muted px-0.5 py-px text-center text-[7px] text-muted-foreground'>
          Minimized
        </div>
      </Show>
      <div class='flex min-h-0 flex-1 flex-col'>{props.children}</div>
    </div>
  )
}

function PreviewGroupTabsChrome(props: { group: LayoutPreviewGroupTabs }) {
  return (
    <PreviewGroupShell group={props.group}>
      <div class='flex min-h-0 flex-1 flex-col'>
        <TabStrip tabs={props.group.tabs} />
        <div class='min-h-0 flex-1 bg-muted/40' />
      </div>
    </PreviewGroupShell>
  )
}

function PreviewGroupSplitChrome(props: { group: LayoutPreviewGroupSplit }) {
  return (
    <PreviewGroupShell group={props.group}>
      <div class='flex min-h-0 flex-1 flex-row'>
        <div
          class='flex min-h-0 min-w-0 flex-col border-r border-border/80'
          style={{ width: `${props.group.leftPaneFraction * 100}%` }}
        >
          <TabStrip tabs={props.group.leftTabs} dense />
          <div class='min-h-0 flex-1 bg-muted/35' />
        </div>
        <div class='w-0.5 shrink-0 self-stretch bg-border' />
        <div class='flex min-h-0 min-w-0 flex-1 flex-col'>
          <TabStrip tabs={props.group.rightTabs} dense />
          <div class='min-h-0 flex-1 bg-muted/35' />
        </div>
      </div>
    </PreviewGroupShell>
  )
}

function PreviewGroupChrome(props: { group: LayoutPreviewGroup }) {
  return (
    <>
      <Show when={props.group.mode === 'tabs'}>
        <PreviewGroupTabsChrome group={props.group as LayoutPreviewGroupTabs} />
      </Show>
      <Show when={props.group.mode === 'split'}>
        <PreviewGroupSplitChrome group={props.group as LayoutPreviewGroupSplit} />
      </Show>
    </>
  )
}

export function WorkspaceLayoutHoverPreview(props: {
  snapshot: PersistedWorkspaceState
  'aria-label': string
}) {
  const detail = createMemo(() => computeLayoutPreviewDetail(props.snapshot))

  return (
    <Show when={detail()}>
      {(getDetail) => {
        const d = getDetail()
        const w = PREVIEW_WIDTH_PX
        const h = w / d.aspectRatio
        return (
          <div
            data-testid='workspace-layout-hover-preview'
            role='img'
            aria-label={props['aria-label']}
            class='rounded-md border-2 border-border bg-muted/35 shadow-xl ring-1 ring-black/10 dark:ring-white/10'
            style={{
              width: `${w}px`,
              height: `${h}px`,
              position: 'relative',
            }}
          >
            <For each={d.groups}>{(g) => <PreviewGroupChrome group={g} />}</For>
          </div>
        )
      }}
    </Show>
  )
}
