import { Effect } from 'effect'
import { controllerView, modelOwner, view } from 'effectweb'
import { modalFocus } from '@/lib/ui/modal-focus'
import { modalDialogBackdropClass } from '@/features/explorer/modal-overlay-scope'
import { IMAGE_PAPERS, imagePrintLayout, type ImagePrintOptions } from '@/lib/printing/image-layout'
import { printFrame } from '@/lib/printing/print-frame'
import { imageOutput } from './image-output'

type Props = { path: string; rotation: number; embedded?: boolean; onClose: () => void }
export const ImagePrintDialog = controllerView(
  {
    controller: (props: Props) => {
      const owner = modelOwner({
        props,
        options: { paper: 'a4', orientation: 'auto', margin: 10, width: null } as ImagePrintOptions,
        size: 'fit',
        customWidth: '150',
        pending: false,
        loading: true,
        error: '',
        image: null as null | { url: string; width: number; height: number; outputWidth: number },
      })
      let url = ''
      owner.own({
        dispose: () => {
          if (url) URL.revokeObjectURL(url)
        },
      })
      owner.run(
        'load',
        Effect.tryPromise({
          try: (signal) => imageOutput(props.path, props.rotation, signal, 4096),
          catch: (error) =>
            error instanceof Error ? error : new Error('Could not prepare the image.'),
        }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              url = URL.createObjectURL(result.blob)
              owner.patch({
                loading: false,
                image: {
                  url,
                  width: result.width,
                  height: result.height,
                  outputWidth: result.outputWidth,
                },
              })
            }),
          ),
          Effect.catch((error) =>
            Effect.sync(() =>
              owner.patch({
                loading: false,
                error: error instanceof Error ? error.message : 'Could not prepare the image.',
              }),
            ),
          ),
        ),
        'replace',
      )
      const actions = {
        close: () => {
          owner.cancel('print')
          owner.read().props.onClose()
        },
        paper: (paper: string) => {
          if (paper in IMAGE_PAPERS)
            owner.patch({
              options: { ...owner.read().options, paper: paper as ImagePrintOptions['paper'] },
            })
        },
        orientation: (orientation: string) => {
          if (orientation === 'auto' || orientation === 'portrait' || orientation === 'landscape')
            owner.patch({ options: { ...owner.read().options, orientation } })
        },
        margin: (value: string) =>
          owner.patch({
            options: { ...owner.read().options, margin: value.trim() ? Number(value) : NaN },
          }),
        size: (size: string) =>
          owner.patch({
            size,
            options: {
              ...owner.read().options,
              width: size === 'fit' ? null : Number(owner.read().customWidth),
            },
          }),
        width: (customWidth: string) =>
          owner.patch({
            customWidth,
            options: { ...owner.read().options, width: Number(customWidth) },
          }),
        print: () => {
          const current = owner.read(),
            image = current.image
          if (!image || current.pending) return
          const layout = imagePrintLayout(image.width, image.height, current.options)
          if (!layout) return
          owner.patch({ pending: true, error: '' })
          owner.run(
            'print',
            printFrame(
              current.props.path.split('/').at(-1) ?? 'Image',
              'Image print document',
              ({ doc, style }) =>
                Effect.gen(function* () {
                  style.textContent = `@page{size:${layout.pageWidth}mm ${layout.pageHeight}mm;margin:0}html,body{margin:0;padding:0}body{width:${layout.pageWidth}mm;height:${layout.pageHeight}mm;overflow:hidden}img{position:absolute;left:${layout.left}mm;top:${layout.top}mm;width:${layout.width}mm;height:${layout.height}mm}`
                  const picture = doc.createElement('img')
                  picture.src = image.url
                  picture.alt = current.props.path.split('/').at(-1) ?? 'Image'
                  doc.body.append(picture)
                  yield* Effect.tryPromise(() => picture.decode())
                }),
            ).pipe(
              Effect.tap(() => Effect.sync(() => owner.read().props.onClose())),
              Effect.catch((error) =>
                Effect.sync(() =>
                  owner.patch({
                    pending: false,
                    error: error instanceof Error ? error.message : 'Could not print the image.',
                  }),
                ),
              ),
            ),
            'drop',
          )
        },
      }
      return {
        source: owner.source,
        ...actions,
        lifetime: owner,
        receive: (props: Props) => owner.patch({ props }),
      }
    },
  },
  view((model) => {
    const image = model.image,
      layout = image ? imagePrintLayout(image.width, image.height, model.options) : null
    const field = 'rounded border border-input bg-background px-2 py-1.5 text-sm'
    return (
      <div
        data-no-window-drag
        class={`${modalDialogBackdropClass(model.props.embedded ? 'window' : 'viewport')} z-[80]`}
      >
        <form
          role='dialog'
          aria-modal='true'
          aria-label='Print image'
          class='flex max-h-full w-full max-w-md flex-col gap-3 overflow-auto rounded-lg border border-border bg-background p-4 text-foreground shadow-xl'
          use={modalFocus({ onEscape: model.actions.close })}
          onSubmit={(event) => {
            event.preventDefault()
            model.actions.print()
          }}
        >
          <h2 class='text-base font-semibold'>Print image</h2>
          {image && layout ? (
            <div
              class='flex h-48 shrink-0 items-center justify-center rounded bg-muted p-2'
              aria-label='Print preview'
            >
              <div
                class='relative max-h-full bg-white shadow'
                style={{
                  'aspect-ratio': `${layout.pageWidth}/${layout.pageHeight}`,
                  height: '100%',
                  'max-width': '100%',
                }}
              >
                <img
                  alt='Image placement on paper'
                  src={image.url}
                  class='absolute'
                  style={{
                    left: `${(100 * layout.left) / layout.pageWidth}%`,
                    top: `${(100 * layout.top) / layout.pageHeight}%`,
                    width: `${(100 * layout.width) / layout.pageWidth}%`,
                    height: `${(100 * layout.height) / layout.pageHeight}%`,
                  }}
                />
              </div>
            </div>
          ) : null}
          <fieldset disabled={model.pending} class='grid grid-cols-2 gap-3 disabled:opacity-60'>
            <label class='flex flex-col gap-1 text-sm'>
              Paper
              <select
                aria-label='Paper'
                class={field}
                value={model.options.paper}
                onChange={(event) => model.actions.paper(event.currentTarget.value)}
              >
                <option value='a4'>A4</option>
                <option value='letter'>Letter</option>
                <option value='photo'>Photo 4 × 6 in</option>
              </select>
            </label>
            <label class='flex flex-col gap-1 text-sm'>
              Orientation
              <select
                aria-label='Orientation'
                class={field}
                value={model.options.orientation}
                onChange={(event) => model.actions.orientation(event.currentTarget.value)}
              >
                <option value='auto'>Automatic</option>
                <option value='portrait'>Portrait</option>
                <option value='landscape'>Landscape</option>
              </select>
            </label>
            <label class='flex flex-col gap-1 text-sm'>
              Size
              <select
                aria-label='Size'
                class={field}
                value={model.size}
                onChange={(event) => model.actions.size(event.currentTarget.value)}
              >
                <option value='fit'>Fit to page</option>
                <option value='custom'>Custom width</option>
              </select>
            </label>
            <label class='flex flex-col gap-1 text-sm'>
              Margin (mm)
              <input
                type='number'
                min='0'
                max='30'
                step='1'
                class={field}
                value={Number.isFinite(model.options.margin) ? model.options.margin : ''}
                onInput={(event) => model.actions.margin(event.currentTarget.value)}
              />
            </label>
            {model.size === 'custom' ? (
              <label class='col-span-2 flex flex-col gap-1 text-sm'>
                Image width (mm)
                <input
                  class={field}
                  type='number'
                  min='1'
                  step='0.1'
                  value={model.customWidth}
                  onInput={(event) => model.actions.width(event.currentTarget.value)}
                />
              </label>
            ) : null}
          </fieldset>
          {layout && image ? (
            <p class='text-xs text-muted-foreground'>
              {layout.width.toFixed(1)} × {layout.height.toFixed(1)} mm ·{' '}
              {Math.round((image.outputWidth / layout.width) * 25.4)} dpi. Proportions are
              preserved. Choose matching paper in the printer dialog.
            </p>
          ) : image ? (
            <p role='alert' class='text-sm text-destructive'>
              Choose a margin from 0 to 30 mm and an image width that fits on the page.
            </p>
          ) : null}
          {model.error ? (
            <p role='alert' class='text-sm text-destructive'>
              {model.error}
            </p>
          ) : null}
          {model.loading || model.pending ? (
            <p role='status' class='text-sm'>
              {model.loading
                ? 'Preparing image…'
                : 'Printing… Close the printer dialog to return, or cancel here.'}
            </p>
          ) : null}
          <div class='flex justify-end gap-2'>
            <button
              type='button'
              class='rounded border border-input px-3 py-1.5 text-sm hover:bg-muted'
              onClick={model.actions.close}
            >
              Cancel
            </button>
            <button
              type='submit'
              disabled={!layout || model.pending}
              class='rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-40'
            >
              Print
            </button>
          </div>
        </form>
      </div>
    )
  }),
)
