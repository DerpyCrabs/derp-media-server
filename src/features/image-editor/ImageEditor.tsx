import { controllerView, view, domBinding, list, type ControllerModel } from 'effectweb'
import Crop from '@effectweb/lucide/icons/crop'
import RotateCw from '@effectweb/lucide/icons/rotate-cw'
import FlipHorizontal from '@effectweb/lucide/icons/flip-horizontal'
import Scaling from '@effectweb/lucide/icons/scaling'
import Undo2 from '@effectweb/lucide/icons/undo-2'
import Redo2 from '@effectweb/lucide/icons/redo-2'
import X from '@effectweb/lucide/icons/x'
import { SaveFileDialog } from '@/features/explorer/SaveFileDialog'
import { imageEditorController } from './image-editor-controller'
import { cropImage, validImageSize, selectionFromPoints, type CropRect } from './image-transform'

type Model = ControllerModel<typeof imageEditorController>
const buttonClass =
  'inline-flex size-8 shrink-0 items-center justify-center rounded hover:bg-muted disabled:opacity-35'
const inputClass = 'w-20 rounded border border-input bg-background px-2 py-1 text-sm'
const exportFormats = [
  { value: 'image/png', extension: 'png', label: 'PNG — lossless, transparency' },
  { value: 'image/jpeg', extension: 'jpg', label: 'JPEG — smaller, white background' },
]
const cropFields: readonly { key: keyof CropRect; label: string }[] = [
  { key: 'x', label: 'Left' },
  { key: 'y', label: 'Top' },
  { key: 'width', label: 'Width' },
  { key: 'height', label: 'Height' },
]
const canvasBinding = (canvas: HTMLCanvasElement, current: () => Model) => {
  let previous: unknown
  const stage = canvas.parentElement!
  const host = stage.parentElement!
  const layout = () => {
    const edit = current().history[current().cursor]
    if (!edit) return
    const scale = Math.min(
      Math.max(1, host.clientWidth - 32) / edit.width,
      Math.max(1, host.clientHeight - 32) / edit.height,
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
      layout()
    }
  }
  update()
  return { update, dispose: () => observer.disconnect() }
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
      current().actions.save()
    } else if (!input && mod && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      event.stopPropagation()
      if (event.shiftKey) current().actions.redo()
      else current().actions.undo()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      current().actions.close()
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
    const handle =
      event.target instanceof Element ? (event.target.getAttribute('data-crop-handle') ?? '') : ''
    drag = { id: event.pointerId, start: point(event), selection: current().selection, handle }
    element.setPointerCapture(event.pointerId)
    if (!handle)
      current().actions.selection(
        selectionFromPoints(drag.start, drag.start, current().history[current().cursor]!),
      )
  }
  const move = (event: PointerEvent) => {
    if (!drag || drag.id !== event.pointerId) return
    const edit = current().history[current().cursor]!,
      end = point(event),
      selection = drag.selection
    if (drag.handle === 'move' && selection) {
      current().actions.selection({
        ...selection,
        x: Math.round(
          Math.max(0, Math.min(edit.width - selection.width, selection.x + end.x - drag.start.x)),
        ),
        y: Math.round(
          Math.max(0, Math.min(edit.height - selection.height, selection.y + end.y - drag.start.y)),
        ),
      })
    } else if (drag.handle && selection) {
      const anchor = {
        x: drag.handle.includes('w') ? selection.x + selection.width : selection.x,
        y: drag.handle.includes('n') ? selection.y + selection.height : selection.y,
      }
      current().actions.selection(selectionFromPoints(anchor, end, edit))
    } else current().actions.selection(selectionFromPoints(drag.start, end, edit))
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
const ImageEditor = controllerView(
  { controller: imageEditorController },
  view((model) => {
    const edit = model.history[model.cursor],
      selection = model.selection
    const ready = !!edit && !model.pending
    const fileName = model.props.path.split('/').at(-1) ?? ''
    const dot = model.props.path.lastIndexOf('.')
    const suggestedPath = `${dot > model.props.path.lastIndexOf('/') ? model.props.path.slice(0, dot) : model.props.path}-edited.png`
    return (
      <div
        role='region'
        aria-label='Image editor'
        tabindex={-1}
        data-no-window-drag
        class={
          model.props.embedded
            ? 'relative flex h-full min-h-0 flex-col bg-background text-foreground outline-none'
            : 'fixed inset-0 z-50 flex flex-col bg-background text-foreground outline-none'
        }
        use={domBinding(model, editorBehavior)}
      >
        <header class='flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1'>
          <span class='mr-auto min-w-0 max-w-48 truncate px-1 text-sm' title={fileName}>
            {fileName}
          </span>
          <button
            type='button'
            class={buttonClass}
            aria-label='Undo image edit'
            title='Undo (Ctrl+Z)'
            disabled={!ready || model.cursor === 0}
            onClick={model.actions.undo}
          >
            <Undo2 size={16} />
          </button>
          <button
            type='button'
            class={buttonClass}
            aria-label='Redo image edit'
            title='Redo (Ctrl+Shift+Z)'
            disabled={!ready || model.cursor >= model.history.length - 1}
            onClick={model.actions.redo}
          >
            <Redo2 size={16} />
          </button>
          <button
            type='button'
            class='rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-40'
            disabled={!ready}
            onClick={model.actions.save}
          >
            Save copy
          </button>
          <button
            type='button'
            class={buttonClass}
            aria-label='Close image editor'
            disabled={model.pending}
            onClick={model.actions.close}
          >
            <X size={16} />
          </button>
        </header>
        <div
          role='toolbar'
          aria-label='Image editing tools'
          class='flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1'
        >
          <button
            type='button'
            class={buttonClass}
            aria-label='Crop image'
            title='Crop'
            aria-pressed={model.tool === 'crop'}
            disabled={!ready}
            onClick={() => model.actions.tool('crop')}
          >
            <Crop size={17} />
          </button>
          <button
            type='button'
            class={buttonClass}
            aria-label='Rotate image clockwise'
            title='Rotate clockwise'
            disabled={!ready}
            onClick={model.actions.rotate}
          >
            <RotateCw size={17} />
          </button>
          <button
            type='button'
            class={buttonClass}
            aria-label='Flip image horizontally'
            title='Flip horizontally'
            disabled={!ready}
            onClick={model.actions.flip}
          >
            <FlipHorizontal size={17} />
          </button>
          <button
            type='button'
            class={buttonClass}
            aria-label='Resize image'
            title='Resize'
            aria-pressed={model.tool === 'resize'}
            disabled={!ready}
            onClick={() => model.actions.tool('resize')}
          >
            <Scaling size={17} />
          </button>
          {edit ? (
            <span class='ml-auto px-2 text-xs text-muted-foreground' role='status'>
              {edit.width} × {edit.height} px
            </span>
          ) : null}
        </div>
        {model.tool === 'crop' && edit ? (
          <div class='flex shrink-0 flex-wrap items-end gap-2 border-b border-border p-2'>
            {selection ? (
              <>
                {list(
                  cropFields,
                  (field) => field.key,
                  (field) => (
                    <label class='flex flex-col gap-1 text-xs'>
                      {field.label}
                      <input
                        aria-label={`Crop ${field.label.toLowerCase()}`}
                        type='number'
                        min={field.key === 'x' || field.key === 'y' ? 0 : 1}
                        step={1}
                        class={inputClass}
                        value={selection[field.key]}
                        onInput={(event) =>
                          model.actions.cropField(field.key, event.currentTarget.valueAsNumber)
                        }
                      />
                    </label>
                  ),
                )}
                <button
                  type='button'
                  class='rounded border border-input px-3 py-1 text-sm disabled:opacity-40'
                  disabled={!cropImage(edit, selection)}
                  onClick={model.actions.crop}
                >
                  Apply crop
                </button>
              </>
            ) : (
              <>
                <p class='py-1 text-sm text-muted-foreground'>
                  Drag on the image to select an area.
                </p>
                <button
                  type='button'
                  class='rounded border border-input px-3 py-1 text-sm'
                  onClick={model.actions.selectAll}
                >
                  Select all
                </button>
              </>
            )}
          </div>
        ) : null}
        {model.tool === 'resize' && edit ? (
          <div class='flex shrink-0 flex-wrap items-end gap-2 border-b border-border p-2'>
            <label class='flex flex-col gap-1 text-xs'>
              Width
              <input
                aria-label='Image width'
                type='number'
                min={1}
                max={16384}
                step={1}
                class={inputClass}
                value={model.resizeWidth}
                onInput={(event) =>
                  model.actions.resizeField('width', event.currentTarget.valueAsNumber)
                }
              />
            </label>
            <label class='flex flex-col gap-1 text-xs'>
              Height
              <input
                aria-label='Image height'
                type='number'
                min={1}
                max={16384}
                step={1}
                class={inputClass}
                value={model.resizeHeight}
                onInput={(event) =>
                  model.actions.resizeField('height', event.currentTarget.valueAsNumber)
                }
              />
            </label>
            <label class='flex items-center gap-1 py-1 text-xs'>
              <input
                type='checkbox'
                checked={model.keepRatio}
                onChange={(event) => model.actions.keepRatio(event.currentTarget.checked)}
              />
              Keep proportions
            </label>
            <button
              type='button'
              class='rounded border border-input px-3 py-1 text-sm disabled:opacity-40'
              disabled={!validImageSize(model.resizeWidth, model.resizeHeight)}
              onClick={model.actions.resize}
            >
              Apply size
            </button>
          </div>
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
        <div class='flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black/90 p-4'>
          {edit ? (
            <div
              class='relative max-h-full max-w-full overflow-hidden'
              style={{
                'aspect-ratio': `${edit.width} / ${edit.height}`,

                'touch-action': model.tool === 'crop' ? 'none' : 'auto',
                cursor: model.tool === 'crop' ? 'crosshair' : 'default',
              }}
              use={domBinding(model, cropBinding)}
              data-testid='image-edit-stage'
            >
              <canvas
                role='img'
                aria-label='Edited image preview'
                class='block h-full w-full'
                use={domBinding(model, canvasBinding)}
              />
              {selection && model.tool === 'crop' ? (
                <div
                  data-crop-handle='move'
                  class='absolute cursor-move border border-white'
                  style={{
                    left: `${(selection.x / edit.width) * 100}%`,
                    top: `${(selection.y / edit.height) * 100}%`,
                    width: `${(selection.width / edit.width) * 100}%`,
                    height: `${(selection.height / edit.height) * 100}%`,
                    'box-shadow': '0 0 0 9999px #0008',
                  }}
                >
                  <span
                    data-crop-handle='nw'
                    class='absolute -left-1.5 -top-1.5 size-3 cursor-nwse-resize border border-black bg-white'
                  />
                  <span
                    data-crop-handle='ne'
                    class='absolute -right-1.5 -top-1.5 size-3 cursor-nesw-resize border border-black bg-white'
                  />
                  <span
                    data-crop-handle='sw'
                    class='absolute -bottom-1.5 -left-1.5 size-3 cursor-nesw-resize border border-black bg-white'
                  />
                  <span
                    data-crop-handle='se'
                    class='absolute -bottom-1.5 -right-1.5 size-3 cursor-nwse-resize border border-black bg-white'
                  />
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
            description='Exports the visible image. Animation and original metadata are not included.'
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
