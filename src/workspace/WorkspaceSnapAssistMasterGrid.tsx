import type { AssistGridShape, AssistGridSpan } from '@/lib/workspace-assist-grid'
import { assistShapeToDims, assistSpanToGridLines } from '@/lib/workspace-assist-grid'
import type { AssistSlotPick } from '@/lib/workspace-snap-pick'
import { assistPickMatchesGridSpan } from '@/lib/workspace-snap-pick'
import { cn } from '@/lib/utils'
import { Index, Show, createMemo } from 'solid-js'

type Placement = {
  kind: 'cell' | 'vgutter' | 'hgutter' | 'junction'
  gridColumn: number
  gridRow: string | number
  zIndex?: number
  span: AssistGridSpan
}

function buildPlacements(cols: number, rows: number): Placement[] {
  const out: Placement[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const gc = c * 2 + 1
      const gr = r * 2 + 1
      out.push({
        kind: 'cell',
        gridColumn: gc,
        gridRow: gr,
        span: {
          gridCols: cols,
          gridRows: rows,
          gc0: c,
          gc1: c,
          gr0: r,
          gr1: r,
        },
      })
    }
  }
  for (let c = 0; c < cols - 1; c++) {
    const gc = (c + 1) * 2
    for (let r = 0; r < rows; r++) {
      const gr = r * 2 + 1
      out.push({
        kind: 'vgutter',
        gridColumn: gc,
        gridRow: gr,
        span: {
          gridCols: cols,
          gridRows: rows,
          gc0: c,
          gc1: c + 1,
          gr0: r,
          gr1: r,
        },
      })
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    const gr = (r + 1) * 2
    for (let c = 0; c < cols; c++) {
      const gc = c * 2 + 1
      out.push({
        kind: 'hgutter',
        gridColumn: gc,
        gridRow: gr,
        span: {
          gridCols: cols,
          gridRows: rows,
          gc0: c,
          gc1: c,
          gr0: r,
          gr1: r + 1,
        },
      })
    }
  }
  for (let c = 0; c < cols - 1; c++) {
    for (let r = 0; r < rows - 1; r++) {
      const gc = (c + 1) * 2
      const gr = (r + 1) * 2
      out.push({
        kind: 'junction',
        gridColumn: gc,
        gridRow: gr,
        zIndex: 10,
        span: {
          gridCols: cols,
          gridRows: rows,
          gc0: c,
          gc1: c + 1,
          gr0: r,
          gr1: r + 1,
        },
      })
    }
  }
  return out
}

function defaultShapeLabel(shape: AssistGridShape): string {
  switch (shape) {
    case '3x2':
      return '3×2'
    case '3x3':
      return '3×3'
    case '2x2':
      return '2×2'
    case '2x3':
      return '2×3'
  }
}

function placementLabel(span: AssistGridSpan): string {
  const columns = span.gc0 === span.gc1 ? `column ${span.gc0 + 1}` : `columns ${span.gc0 + 1} to ${span.gc1 + 1}`
  const rows = span.gr0 === span.gr1 ? `row ${span.gr0 + 1}` : `rows ${span.gr0 + 1} to ${span.gr1 + 1}`
  return `${columns}, ${rows}`
}

export type WorkspaceSnapAssistMasterGridProps = {
  shape: AssistGridShape
  /** Read on each reactive pass so hover updates (plain props + inner `<For>` do not). */
  getHoverPick: () => AssistSlotPick | null
  aspectRatio: number
  /** Shown above the mini grid; defaults to the shape label (e.g. 3×2). */
  layoutLabel?: string
  pickMode?: boolean
  onPickSpan?: (span: AssistGridSpan) => void
  isSpanDisabled?: (span: AssistGridSpan) => boolean
}

export function WorkspaceSnapAssistMasterGrid(props: WorkspaceSnapAssistMasterGridProps) {
  const pick = createMemo(() => props.getHoverPick())

  const placements = createMemo(() => {
    const { cols, rows } = assistShapeToDims(props.shape)
    return buildPlacements(cols, rows)
  })

  const gridTemplate = createMemo(() => {
    const { cols, rows } = assistShapeToDims(props.shape)
    const colT = Array.from({ length: cols * 2 - 1 }, (_, i) => (i % 2 === 0 ? 'minmax(0,1fr)' : '6px')).join(' ')
    const rowT = Array.from({ length: rows * 2 - 1 }, (_, i) => (i % 2 === 0 ? 'minmax(0,1fr)' : '6px')).join(' ')
    return { colT, rowT }
  })

  const hoverSpan = createMemo(() => pick()?.span ?? null)

  const hoverLines = createMemo(() => {
    const h = hoverSpan()
    if (!h) return null
    if (h.gridCols !== assistShapeToDims(props.shape).cols) return null
    if (h.gridRows !== assistShapeToDims(props.shape).rows) return null
    return assistSpanToGridLines(h)
  })

  const title = createMemo(() => props.layoutLabel ?? defaultShapeLabel(props.shape))

  return (
    <div
      class={cn(
        'flex min-w-0 flex-col',
        props.pickMode &&
          'rounded-lg border border-transparent bg-muted/20 p-2 transition-colors hover:border-border hover:bg-muted/35 focus-within:border-primary/50',
      )}
      data-assist-mini-grid={props.shape}
      role="group"
      aria-label={`Layout ${title()}`}
    >
      <div
        data-assist-master-grid
        class={cn(
          'relative grid shrink-0 rounded-md border border-border bg-background/70 p-1 shadow-inner',
          props.pickMode ? 'w-full' : 'w-21 sm:w-24',
        )}
        style={{
          'aspect-ratio': String(props.aspectRatio),
          'grid-template-columns': gridTemplate().colT,
          'grid-template-rows': gridTemplate().rowT,
        }}
      >
        <Index each={placements()}>
          {(p) => {
            const active = createMemo(() => assistPickMatchesGridSpan(pick(), p().span))
            const disabled = createMemo(() => props.isSpanDisabled?.(p().span) ?? false)
            const isFirstCell = createMemo(
              () => p().kind === 'cell' && p().span.gc0 === 0 && p().span.gr0 === 0 && p().span.gc1 === 0,
            )
            const isFirstColumnHgutter = createMemo(
              () =>
                p().kind === 'hgutter' &&
                p().span.gc0 === 0 &&
                p().span.gc1 === 0 &&
                p().span.gr0 === 0 &&
                p().span.gr1 === 1,
            )
            const isVgutterTwoColsTopRow = createMemo(
              () =>
                p().kind === 'vgutter' &&
                p().span.gc0 === 0 &&
                p().span.gc1 === 1 &&
                p().span.gr0 === 0 &&
                p().span.gr1 === 0,
            )
            const tileClass = createMemo(() =>
              p().kind === 'cell'
                ? 'rounded-sm border border-border bg-muted shadow-sm'
                : p().kind === 'junction'
                  ? 'rounded-sm bg-background'
                  : 'bg-background',
            )
            return (
              <button
                type="button"
                tabIndex={props.pickMode && !disabled() ? 0 : -1}
                disabled={disabled()}
                aria-label={`${title()}: ${placementLabel(p().span)}`}
                data-assist-grid-span
                data-gc0={String(p().span.gc0)}
                data-gc1={String(p().span.gc1)}
                data-gr0={String(p().span.gr0)}
                data-gr1={String(p().span.gr1)}
                data-grid-cols={String(p().span.gridCols)}
                data-grid-rows={String(p().span.gridRows)}
                data-testid={
                  isFirstCell()
                    ? 'snap-assist-master-cell'
                    : isFirstColumnHgutter()
                      ? 'snap-assist-hgutter-col0'
                      : isVgutterTwoColsTopRow()
                        ? 'snap-assist-vgutter-two-cols-top'
                        : undefined
                }
                data-snap-assist-hover-active={active() ? '' : undefined}
                class={cn(
                  'border-0 p-0 transition-all duration-100 focus-visible:z-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                  tileClass(),
                  props.pickMode && p().kind === 'cell' && !disabled()
                    ? 'hover:border-primary/70 hover:bg-primary/15'
                    : '',
                  disabled() ? 'cursor-not-allowed opacity-25' : '',
                  !props.pickMode && (p().kind === 'vgutter' || p().kind === 'hgutter' || p().kind === 'junction')
                    ? 'cursor-default'
                    : '',
                )}
                style={{
                  'grid-column': p().gridColumn,
                  'grid-row': p().gridRow,
                  ...(p().zIndex != null ? { 'z-index': p().zIndex } : {}),
                }}
                onClick={() => {
                  if (props.pickMode && !disabled()) props.onPickSpan?.(p().span)
                }}
              />
            )
          }}
        </Index>
        <Show when={hoverLines()}>
          {(lines) => (
            <div
              class="pointer-events-none z-20 rounded-md border-2 border-primary bg-primary/20 shadow-md ring-2 ring-primary/25"
              style={{
                'grid-column': `${lines().colStart} / ${lines().colEnd}`,
                'grid-row': `${lines().rowStart} / ${lines().rowEnd}`,
              }}
            />
          )}
        </Show>
      </div>
    </div>
  )
}
