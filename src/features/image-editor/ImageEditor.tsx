import { DropdownMenu, type MenuEntry } from '@/lib/ui/menu'
import Ellipsis from '@effectweb/lucide/icons/ellipsis'
import Link from '@effectweb/lucide/icons/link'
import Unlink from '@effectweb/lucide/icons/unlink'
import { Input } from '@/lib/ui/input'
import { Button } from '@/lib/ui/button'
import { controllerView, view, domBinding, list, type ControllerModel } from 'effectweb'
import Check from '@effectweb/lucide/icons/check'
import ChevronDown from '@effectweb/lucide/icons/chevron-down'
import Crop from '@effectweb/lucide/icons/crop'
import RotateCw from '@effectweb/lucide/icons/rotate-cw'
import FlipHorizontal from '@effectweb/lucide/icons/flip-horizontal'
import Scaling from '@effectweb/lucide/icons/scaling'
import Undo2 from '@effectweb/lucide/icons/undo-2'
import Redo2 from '@effectweb/lucide/icons/redo-2'
import X from '@effectweb/lucide/icons/x'
import { SaveFileDialog } from '@/features/explorer/SaveFileDialog'
import { imageEditorController } from './image-editor-controller'
import { cropImage, validImageSize, resizeCrop, type CropRect } from './image-transform'

type Model = ControllerModel<typeof imageEditorController>
const exportFormats = [
  { value: 'image/png', extension: 'png', label: 'PNG' },
  { value: 'image/jpeg', extension: 'jpg', label: 'JPEG' },
]
const cropRatios = [
  { label: 'Free', ratio: null },
  { label: 'Square', ratio: 1 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '3:2', ratio: 3 / 2 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '4:5', ratio: 4 / 5 },
  { label: '9:16', ratio: 9 / 16 },
]
const cropHandles = [
  {
    id: 'nw',
    label: 'top left',
    position: '-left-5 -top-5',
    mark: 'left-5 top-5 border-l-2 border-t-2',
    cursor: 'cursor-nwse-resize',
  },
  {
    id: 'ne',
    label: 'top right',
    position: '-right-5 -top-5',
    mark: 'right-5 top-5 border-r-2 border-t-2',
    cursor: 'cursor-nesw-resize',
  },
  {
    id: 'sw',
    label: 'bottom left',
    position: '-left-5 -bottom-5',
    mark: 'left-5 bottom-5 border-l-2 border-b-2',
    cursor: 'cursor-nesw-resize',
  },
  {
    id: 'se',
    label: 'bottom right',
    position: '-right-5 -bottom-5',
    mark: 'right-5 bottom-5 border-r-2 border-b-2',
    cursor: 'cursor-nwse-resize',
  },
  {
    id: 'n',
    label: 'top',
    position: 'left-1/2 -translate-x-1/2 -top-5',
    mark: 'left-3 top-5 border-t-2',
    cursor: 'cursor-ns-resize',
  },
  {
    id: 's',
    label: 'bottom',
    position: 'left-1/2 -translate-x-1/2 -bottom-5',
    mark: 'left-3 bottom-5 border-b-2',
    cursor: 'cursor-ns-resize',
  },
  {
    id: 'w',
    label: 'left',
    position: 'top-1/2 -translate-y-1/2 -left-5',
    mark: 'top-3 left-5 border-l-2',
    cursor: 'cursor-ew-resize',
  },
  {
    id: 'e',
    label: 'right',
    position: 'top-1/2 -translate-y-1/2 -right-5',
    mark: 'top-3 right-5 border-r-2',
    cursor: 'cursor-ew-resize',
  },
]
const previewBinding = (image: HTMLImageElement, current: () => Model) => {
  const canvas = document.createElement('canvas')
  let generation = 0
  let url: string | undefined
  let previous: unknown
  const stage = image.parentElement!
  const host = stage.parentElement!
  const layout = () => {
    const edit = current().history[current().cursor]
    if (!edit) return
    const scale = Math.min(
      Math.max(1, host.clientWidth - 48) / edit.width,
      Math.max(1, host.clientHeight - 48) / edit.height,
    )
    stage.style.width = `${edit.width * scale}px`
    stage.style.height = `${edit.height * scale}px`
  }
  const observer = new ResizeObserver(layout)
  observer.observe(host)
  const update = () => {
    const state = current(),
      edit = state.history[state.cursor]
    if (edit && previous !== edit) {
      previous = edit
      state.actions.draw(canvas)
      const request = ++generation
      canvas.toBlob((blob) => {
        if (!blob || generation !== request) return
        const previousUrl = url
        url = URL.createObjectURL(blob)
        image.src = url
        if (previousUrl) URL.revokeObjectURL(previousUrl)
      })
      layout()
    }
  }
  update()
  return {
    update,
    dispose: () => {
      generation++
      observer.disconnect()
      if (url) URL.revokeObjectURL(url)
      canvas.width = canvas.height = 1
    },
  }
}
const editorBehavior = (element: HTMLDivElement, current: () => Model) => {
  const warn = (event: BeforeUnloadEvent) => {
    if (current().cursor > 0 && current().history[current().cursor] !== current().exportedEdit) {
      event.preventDefault()
      event.returnValue = ''
    }
  }
  const keydown = (event: KeyboardEvent) => {
    if (current().saveDialog || event.defaultPrevented) return
    const input = event.target instanceof Element && !!event.target.closest('input,select,textarea')
    const mod = event.ctrlKey || event.metaKey
    if (mod && event.key.toLowerCase() === 's') {
      event.preventDefault()
      event.stopPropagation()
      if (current().tool === 'crop') current().actions.crop()
      current().actions.save()
    } else if (!input && mod && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      event.stopPropagation()
      if (event.shiftKey) current().actions.redo()
      else current().actions.undo()
    } else if (!input && event.key === 'Enter' && current().tool === 'crop') {
      event.preventDefault()
      event.stopPropagation()
      current().actions.crop()
    } else if (event.key === 'Enter' && current().tool === 'resize') {
      event.preventDefault()
      event.stopPropagation()
      current().actions.resize()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (current().tool !== 'none') current().actions.cancelTool()
      else current().actions.close()
    }
  }
  let cursor = current().cursor
  let disposed = false
  const update = () => {
    if (cursor === current().cursor) return
    cursor = current().cursor
    queueMicrotask(() => {
      if (!disposed && document.activeElement === document.body)
        element.focus({ preventScroll: true })
    })
  }
  element.addEventListener('keydown', keydown)
  window.addEventListener('beforeunload', warn)
  element.focus({ preventScroll: true })
  return {
    update,
    dispose: () => {
      disposed = true
      element.removeEventListener('keydown', keydown)
      window.removeEventListener('beforeunload', warn)
    },
  }
}
const cropBinding = (element: HTMLDivElement, current: () => Model) => {
  let drag:
    | { id: number; start: { x: number; y: number }; selection: CropRect | null; handle: string }
    | undefined
  const point = (event: PointerEvent) => {
    const rect = element.getBoundingClientRect(),
      edit = current().history[current().cursor]!
    return {
      x: ((event.clientX - rect.left) / rect.width) * edit.width,
      y: ((event.clientY - rect.top) / rect.height) * edit.height,
    }
  }
  const down = (event: PointerEvent) => {
    if (current().tool !== 'crop' || event.button !== 0 || current().pending) return
    event.preventDefault()
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-crop-handle]')
        : null
    const handle = target?.getAttribute('data-crop-handle') ?? ''
    if (!handle || !current().selection) return
    target?.focus({ preventScroll: true })
    drag = { id: event.pointerId, start: point(event), selection: current().selection, handle }
    element.setPointerCapture(event.pointerId)
  }
  const move = (event: PointerEvent) => {
    if (!drag || drag.id !== event.pointerId || !drag.selection) return
    const state = current(),
      edit = state.history[state.cursor]!,
      end = point(event)
    state.actions.selection(
      resizeCrop(
        drag.selection,
        drag.handle,
        end.x - drag.start.x,
        end.y - drag.start.y,
        edit,
        state.cropRatio,
      ),
    )
  }

  const up = (event: PointerEvent) => {
    if (drag?.id !== event.pointerId) return
    move(event)
    drag = undefined
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
  }
  const cancel = () => {
    if (drag) current().actions.selection(drag.selection)
    drag = undefined
  }
  element.addEventListener('pointerdown', down)
  element.addEventListener('pointermove', move)
  element.addEventListener('pointerup', up)
  element.addEventListener('pointercancel', cancel)
  return () => {
    element.removeEventListener('pointerdown', down)
    element.removeEventListener('pointermove', move)
    element.removeEventListener('pointerup', up)
    element.removeEventListener('pointercancel', cancel)
  }
}
function cropKeyDown(model: Model, handle: string, event: KeyboardEvent) {
  const delta = event.shiftKey ? 10 : 1
  const dx = event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0
  const dy = event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0
  const edit = model.history[model.cursor]
  if ((!dx && !dy) || !edit || !model.selection) return
  event.preventDefault()
  event.stopPropagation()
  model.actions.selection(resizeCrop(model.selection, handle, dx, dy, edit, model.cropRatio))
}
const ImageEditor = controllerView(
  { controller: imageEditorController, identity: (props) => props.path },
  view((model) => {
    const edit = model.history[model.cursor],
      selection = model.selection
    const ready = !!edit && !model.pending
    const fileName = model.props.path.split('/').at(-1) ?? ''
    const dot = model.props.path.lastIndexOf('.')
    const suggestedPath = `${dot > model.props.path.lastIndexOf('/') ? model.props.path.slice(0, dot) : model.props.path}-edited.png`
    const menu: MenuEntry[] = [
      {
        kind: 'item',
        label: 'Undo',
        shortcut: 'Ctrl/⌘ Z',
        icon: <Undo2 />,
        disabled: !ready || model.cursor === 0,
        onSelect: model.actions.undo,
      },
      {
        kind: 'item',
        label: 'Redo',
        shortcut: '⇧Ctrl/⌘ Z',
        icon: <Redo2 />,
        disabled: !ready || model.cursor >= model.history.length - 1,
        onSelect: model.actions.redo,
      },
      { kind: 'separator' },
      {
        kind: 'item',
        label: 'Rotate clockwise',
        icon: <RotateCw />,
        disabled: !ready,
        onSelect: model.actions.rotate,
      },
      {
        kind: 'item',
        label: 'Flip horizontally',
        icon: <FlipHorizontal />,
        disabled: !ready,
        onSelect: model.actions.flip,
      },
      ...(model.draftCandidates.length
        ? [
            { kind: 'separator' as const },
            {
              kind: 'item' as const,
              label: 'Restore unsaved edits',
              disabled: model.pending,
              onSelect: model.actions.restoreDraft,
            },
            {
              kind: 'item' as const,
              label: 'Discard recovered edits',
              disabled: model.pending,
              onSelect: model.actions.discardDraft,
            },
          ]
        : []),
    ]
    return (
      <div
        role='region'
        aria-label='Image editor'
        tabindex={-1}
        data-no-window-drag
        class={
          model.props.embedded
            ? 'relative flex h-full min-h-0 flex-col bg-background text-foreground outline-none'
            : 'fixed inset-0 z-[60] flex flex-col bg-background text-foreground outline-none'
        }
        use={domBinding(model, editorBehavior)}
      >
        <header
          class='flex h-12 shrink-0 items-center gap-1 border-b border-border px-2'
          role='toolbar'
          aria-label='Image editing tools'
        >
          {model.tool === 'resize' ? (
            <>
              <Button
                variant='ghost'
                size='icon'
                class='size-11 shrink-0'
                aria-label='Cancel resize'
                onClick={model.actions.cancelTool}
              >
                <X />
              </Button>
              <div class='flex min-w-0 flex-1 items-center justify-center gap-1'>
                <Input
                  aria-label='Image width'
                  title='Width in pixels'
                  type='number'
                  min={1}
                  max={16384}
                  step={1}
                  class='h-11 min-w-0 w-24'
                  value={model.resizeWidth}
                  onInput={(event) =>
                    model.actions.resizeField('width', event.currentTarget.valueAsNumber)
                  }
                />
                <Button
                  variant='ghost'
                  size='icon'
                  class='size-11 shrink-0'
                  aria-label='Keep proportions'
                  title='Keep proportions'
                  aria-pressed={model.keepRatio}
                  onClick={() => model.actions.keepRatio(!model.keepRatio)}
                >
                  {model.keepRatio ? <Link /> : <Unlink />}
                </Button>
                <Input
                  aria-label='Image height'
                  title='Height in pixels'
                  type='number'
                  min={1}
                  max={16384}
                  step={1}
                  class='h-11 min-w-0 w-24'
                  value={model.resizeHeight}
                  onInput={(event) =>
                    model.actions.resizeField('height', event.currentTarget.valueAsNumber)
                  }
                />
                <span class='text-xs text-muted-foreground'>px</span>
              </div>
              <Button
                variant='ghost'
                size='icon'
                class='size-11 shrink-0'
                aria-label='Apply size'
                disabled={!validImageSize(model.resizeWidth, model.resizeHeight)}
                onClick={model.actions.resize}
              >
                <Check />
              </Button>
            </>
          ) : model.tool === 'crop' ? (
            <>
              <Button
                variant='ghost'
                size='icon'
                class='size-11'
                aria-label='Cancel crop'
                onClick={model.actions.cancelTool}
              >
                <X />
              </Button>
              <div class='flex flex-1 justify-center'>
                <DropdownMenu
                  aria-label='Crop proportions'
                  align='center'
                  trigger={
                    <Button variant='ghost' class='h-11' aria-label='Crop proportions'>
                      {cropRatios.find((item) => item.ratio === model.cropRatio)?.label ??
                        'Original'}
                      <ChevronDown />
                    </Button>
                  }
                  items={[
                    ...cropRatios.map((item) => ({
                      kind: 'radio' as const,
                      label: item.label,
                      value: item.label,
                      checked: model.cropRatio === item.ratio,
                      onSelect: () => model.actions.cropRatio(item.ratio),
                    })),
                    { kind: 'separator' },
                    {
                      kind: 'item',
                      label: 'Original proportions',
                      onSelect: () => edit && model.actions.cropRatio(edit.width / edit.height),
                    },
                    {
                      kind: 'item',
                      label: 'Reset selection',
                      onSelect: () => model.actions.cropRatio(model.cropRatio),
                    },
                  ]}
                />
              </div>
              <Button
                variant='ghost'
                size='icon'
                class='size-11'
                aria-label='Apply crop'
                disabled={!edit || !selection || !cropImage(edit, selection)}
                onClick={model.actions.crop}
              >
                <Check />
              </Button>
            </>
          ) : (
            <>
              <span class='min-w-0 flex-1 truncate text-sm font-medium' title={fileName}>
                {fileName}
              </span>
              <Button
                variant='ghost'
                size='icon'
                aria-label='Crop image'
                title='Crop'
                aria-pressed={false}
                disabled={!ready}
                onClick={() => model.actions.tool('crop')}
              >
                <Crop />
              </Button>
              <Button
                variant='ghost'
                size='icon'
                aria-label='Resize image'
                title='Resize'
                aria-pressed={false}
                disabled={!ready}
                onClick={() => model.actions.tool('resize')}
              >
                <Scaling />
              </Button>
              <DropdownMenu
                aria-label='Image edit actions'
                align='end'
                trigger={
                  <Button variant='ghost' size='icon' aria-label='Image edit actions'>
                    <Ellipsis />
                  </Button>
                }
                items={menu}
              />
              <Button disabled={!ready} onClick={model.actions.save}>
                Save copy
              </Button>
              <Button
                variant='ghost'
                size='icon'
                aria-label='Close image editor'
                disabled={model.pending}
                onClick={model.actions.close}
              >
                <X />
              </Button>
            </>
          )}
        </header>
        {model.draftError ? (
          <p role='alert' class='px-3 py-2 text-xs text-destructive'>
            {model.draftError}
          </p>
        ) : null}
        {model.loading ? (
          <p role='status' class='p-4 text-sm'>
            Loading original image…
          </p>
        ) : null}
        {model.error && !model.saveDialog ? (
          <p role='alert' class='p-4 text-sm text-destructive'>
            {model.error}
          </p>
        ) : null}
        <div class='flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black/90 p-6'>
          {edit ? (
            <div
              class='relative max-h-full max-w-full'
              style={{
                'aspect-ratio': `${edit.width} / ${edit.height}`,

                'touch-action': model.tool === 'crop' ? 'none' : 'auto',
                cursor: model.tool === 'crop' ? 'crosshair' : 'default',
              }}
              use={domBinding(model, cropBinding)}
              data-testid='image-edit-stage'
            >
              <img
                alt='Edited image preview'
                draggable={false}
                class='block h-full w-full'
                use={domBinding(model, previewBinding)}
              />
              {selection && model.tool === 'crop' ? (
                <div
                  data-crop-handle='move'
                  role='group'
                  tabindex={0}
                  aria-label='Move crop selection'
                  onKeyDown={(event) => cropKeyDown(model, 'move', event)}
                  class='absolute cursor-move border border-white'
                  style={{
                    left: `${(selection.x / edit.width) * 100}%`,
                    top: `${(selection.y / edit.height) * 100}%`,
                    width: `${(selection.width / edit.width) * 100}%`,
                    height: `${(selection.height / edit.height) * 100}%`,
                    'box-shadow': '0 0 0 9999px #0008',
                  }}
                >
                  <div
                    class='pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3'
                    aria-hidden='true'
                  >
                    <div class='col-start-2 row-span-3 border-x border-white/30' />
                    <div class='absolute inset-x-0 top-1/3 h-1/3 border-y border-white/30' />
                  </div>
                  {list(
                    cropHandles,
                    (handle) => handle.id,
                    (handle) => (
                      <Button
                        variant='ghost'
                        size='icon'
                        data-crop-handle={handle.id}
                        aria-label={`Resize crop ${handle.label}`}
                        onKeyDown={(event) => {
                          cropKeyDown(model, handle.id, event)
                        }}
                        class={`absolute z-10 size-11 touch-none rounded-none border-0 bg-transparent p-0 hover:bg-transparent dark:hover:bg-transparent active:translate-y-0 ${handle.position} ${handle.cursor}`}
                      >
                        <span
                          aria-hidden='true'
                          class={`pointer-events-none absolute size-5 border-white drop-shadow-md ${handle.mark}`}
                        />
                      </Button>
                    ),
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        {model.saveDialog ? (
          <SaveFileDialog
            title='Save image copy'
            suggestedPath={suggestedPath}
            editableFolders={model.props.editableFolders}
            formats={exportFormats}
            pending={model.pending}
            error={model.error}
            overlayScope={model.props.embedded ? 'window' : 'viewport'}
            onConfirm={model.actions.export}
            onDownload={model.actions.download}
            onClose={model.actions.closeSave}
          />
        ) : null}
      </div>
    )
  }),
)
export default ImageEditor
