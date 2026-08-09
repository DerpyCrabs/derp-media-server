import { type CanvasCard, type CanvasConnector, type CanvasWindow } from '@/lib/infinite-canvas'
import Link2 from 'lucide-solid/icons/link-2'
import FileText from 'lucide-solid/icons/file-text'
import Lock from 'lucide-solid/icons/lock'
import LockOpen from 'lucide-solid/icons/lock-open'
import Trash2 from 'lucide-solid/icons/trash-2'
import { For, Show, createMemo } from 'solid-js'

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

type Props = {
  cards: CanvasCard[]
  connectors: CanvasConnector[]
  windows: CanvasWindow[]
  selectedIds: string[]
  connectingFrom: string | null
  readOnly: boolean
  onSelect: (id: string, additive: boolean) => void
  onMoveStart: (id: string, event: PointerEvent) => void
  onResizeStart: (id: string, direction: ResizeDirection, event: PointerEvent) => void
  onChange: (
    id: string,
    patch: Partial<Pick<CanvasCard, 'title' | 'body' | 'url' | 'tags'>>,
  ) => void
  onToggleLock: (id: string) => void
  onDelete: (id: string) => void
  onConnect: (id: string) => void
  onPromote: (id: string) => void
  itemTitle: (id: string) => string
  onChangeConnector: (id: string, label: string) => void
  onDeleteConnector: (id: string) => void
}

function center(props: Props, id: string) {
  const card = props.cards.find((item) => item.id === id)
  const window = props.windows.find((item) => item.id === id)
  const bounds = card?.bounds ?? window?.bounds ?? null
  return bounds ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 } : null
}

export function CanvasCardsLayer(props: Props) {
  const selected = (id: string) => props.selectedIds.includes(id)
  return (
    <>
      <svg class='pointer-events-none absolute inset-0 overflow-visible' aria-hidden='true'>
        <defs>
          <marker
            id='canvas-arrow'
            markerWidth='8'
            markerHeight='8'
            refX='7'
            refY='4'
            orient='auto'
          >
            <path d='M0 0 L8 4 L0 8 Z' fill='context-stroke' />
          </marker>
        </defs>
        <For each={props.connectors}>
          {(connector) => {
            const points = createMemo(() => ({
              from: center(props, connector.fromId),
              to: center(props, connector.toId),
            }))
            return (
              <Show when={points().from && points().to}>
                <g class='pointer-events-none'>
                  <line
                    x1={points().from!.x}
                    y1={points().from!.y}
                    x2={points().to!.x}
                    y2={points().to!.y}
                    stroke={connector.color}
                    stroke-width='2'
                    marker-end='url(#canvas-arrow)'
                  />
                </g>
              </Show>
            )
          }}
        </For>
      </svg>

      <For each={props.cards}>
        {(card) => {
          const bounds = createMemo(() => card.bounds)
          const relationCount = createMemo(
            () =>
              props.connectors.filter(
                (connector) => connector.fromId === card.id || connector.toId === card.id,
              ).length,
          )
          return (
            <article
              data-testid='canvas-card'
              data-card-kind={card.kind}
              data-card-id={card.id}
              class='absolute flex flex-col overflow-hidden rounded-xl border bg-card shadow-xl'
              classList={{
                'ring-2 ring-primary ring-offset-2 ring-offset-background': selected(card.id),
                'opacity-80': card.locked,
              }}
              style={{
                left: `${bounds().x}px`,
                top: `${bounds().y}px`,
                width: `${bounds().width}px`,
                height: `${bounds().height}px`,
                'border-color': card.color,
                'z-index': card.zIndex,
              }}
              onPointerDown={(event) => {
                if ((event.target as HTMLElement).closest('input,textarea,a,button')) return
                props.onSelect(card.id, event.ctrlKey || event.metaKey || event.shiftKey)
              }}
            >
              <header
                class='flex h-9 shrink-0 cursor-grab items-center gap-2 border-b px-2 active:cursor-grabbing'
                style={{ background: `color-mix(in srgb, ${card.color} 14%, var(--card))` }}
                onPointerDown={(event) => {
                  if ((event.target as HTMLElement).closest('button,input')) return
                  props.onMoveStart(card.id, event)
                }}
              >
                <span class='size-2.5 shrink-0 rounded-full' style={{ background: card.color }} />
                <input
                  aria-label='Card title'
                  class='min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none'
                  value={card.title}
                  readOnly={props.readOnly}
                  placeholder='Untitled note'
                  onInput={(event) => props.onChange(card.id, { title: event.currentTarget.value })}
                />
                <Show when={selected(card.id) && !props.readOnly}>
                  <button
                    type='button'
                    title='Promote to Markdown document'
                    aria-label='Promote to Markdown document'
                    class='inline-flex size-8 items-center justify-center rounded hover:bg-background/70'
                    onClick={() => props.onPromote(card.id)}
                  >
                    <FileText class='size-3.5' />
                  </button>
                  <button
                    type='button'
                    title={
                      props.connectingFrom === card.id ? 'Cancel connection' : 'Connect to item'
                    }
                    aria-label={
                      props.connectingFrom === card.id ? 'Cancel connection' : 'Connect to item'
                    }
                    class='inline-flex size-7 items-center justify-center rounded hover:bg-background/70'
                    onClick={() => props.onConnect(card.id)}
                  >
                    <Link2 class='size-3.5' />
                  </button>
                  <button
                    type='button'
                    title={card.locked ? 'Unlock card' : 'Lock card'}
                    aria-label={card.locked ? 'Unlock card' : 'Lock card'}
                    class='inline-flex size-7 items-center justify-center rounded hover:bg-background/70'
                    onClick={() => props.onToggleLock(card.id)}
                  >
                    <Show when={card.locked} fallback={<LockOpen class='size-3.5' />}>
                      <Lock class='size-3.5' />
                    </Show>
                  </button>
                  <button
                    type='button'
                    title='Delete card'
                    aria-label='Delete card'
                    class='inline-flex size-7 items-center justify-center rounded text-destructive hover:bg-destructive/10'
                    onClick={() => props.onDelete(card.id)}
                  >
                    <Trash2 class='size-3.5' />
                  </button>
                </Show>
              </header>
              <textarea
                aria-label={`${card.title || 'Untitled note'} body`}
                class='min-h-0 flex-1 resize-none bg-transparent p-3 font-sans text-sm leading-6 outline-none'
                value={card.body}
                readOnly={props.readOnly}
                placeholder='Start typing… Markdown supported.'
                onInput={(event) => props.onChange(card.id, { body: event.currentTarget.value })}
              />
              <div class='flex h-8 shrink-0 items-center border-t'>
                <input
                  aria-label='Card tags'
                  class='min-w-0 flex-1 bg-transparent px-3 text-xs text-muted-foreground outline-none'
                  value={card.tags.join(', ')}
                  readOnly={props.readOnly}
                  placeholder='tags, comma-separated'
                  onChange={(event) =>
                    props.onChange(card.id, {
                      tags: event.currentTarget.value
                        .split(',')
                        .map((tag) => tag.trim())
                        .filter(Boolean),
                    })
                  }
                />
                <Show when={relationCount() > 0}>
                  <span
                    class='shrink-0 border-l px-2 text-[11px] text-muted-foreground'
                    title={`${relationCount()} related item${relationCount() === 1 ? '' : 's'}`}
                  >
                    {relationCount()} link{relationCount() === 1 ? '' : 's'}
                  </span>
                </Show>
              </div>
              <Show when={selected(card.id) && !card.locked && !props.readOnly}>
                <button
                  type='button'
                  data-card-resize='se'
                  aria-label='Resize card'
                  class='absolute right-0 bottom-0 size-5 cursor-se-resize'
                  onPointerDown={(event) => props.onResizeStart(card.id, 'se', event)}
                />
              </Show>
            </article>
          )
        }}
      </For>
      <For each={props.connectors}>
        {(connector) => {
          const points = createMemo(() => ({
            from: center(props, connector.fromId),
            to: center(props, connector.toId),
          }))
          const editing = () => selected(connector.fromId) || selected(connector.toId)
          return (
            <Show when={points().from && points().to}>
              <Show
                when={editing()}
                fallback={
                  <Show when={connector.label}>
                    <span
                      class='pointer-events-none absolute z-[2000000] -translate-x-1/2 -translate-y-1/2 rounded border border-border bg-popover/90 px-2 py-1 text-xs shadow-sm'
                      style={{
                        left: `${(points().from!.x + points().to!.x) / 2}px`,
                        top: `${(points().from!.y + points().to!.y) / 2}px`,
                      }}
                    >
                      {connector.label}
                    </span>
                  </Show>
                }
              >
                <div
                  class='absolute z-[2000000] flex h-10 w-48 -translate-x-1/2 -translate-y-1/2 items-center rounded-md border border-border bg-popover/95 px-1 shadow-md'
                  style={{
                    left: `${(points().from!.x + points().to!.x) / 2}px`,
                    top: `${(points().from!.y + points().to!.y) / 2}px`,
                  }}
                >
                  <input
                    aria-label={`Relationship from ${props.itemTitle(connector.fromId)} to ${props.itemTitle(connector.toId)}`}
                    class='min-w-0 flex-1 bg-transparent px-2 text-xs outline-none'
                    value={connector.label}
                    placeholder='Relationship'
                    onInput={(event) =>
                      props.onChangeConnector(connector.id, event.currentTarget.value)
                    }
                  />
                  <button
                    type='button'
                    aria-label='Delete relationship'
                    title='Delete relationship'
                    class='inline-flex size-8 shrink-0 items-center justify-center rounded text-destructive hover:bg-destructive/10'
                    onClick={() => props.onDeleteConnector(connector.id)}
                  >
                    <Trash2 class='size-3.5' />
                  </button>
                </div>
              </Show>
            </Show>
          )
        }}
      </For>
    </>
  )
}
