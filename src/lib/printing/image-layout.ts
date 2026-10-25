export const IMAGE_PAPERS = {
  a4: { label: 'A4', width: 210, height: 297 },
  letter: { label: 'Letter', width: 215.9, height: 279.4 },
  photo: { label: 'Photo 4 × 6 in', width: 101.6, height: 152.4 },
} as const
export type ImagePrintOptions = {
  paper: keyof typeof IMAGE_PAPERS
  orientation: 'auto' | 'portrait' | 'landscape'
  margin: number
  width: number | null
}
export function imagePrintLayout(width: number, height: number, options: ImagePrintOptions) {
  const paper = IMAGE_PAPERS[options.paper]
  const landscape =
    options.orientation === 'landscape' || (options.orientation === 'auto' && width > height)
  const pageWidth = landscape ? paper.height : paper.width
  const pageHeight = landscape ? paper.width : paper.height
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(options.margin) ||
    options.margin < 0 ||
    options.margin > 30
  )
    return null
  const availableWidth = pageWidth - 2 * options.margin
  const availableHeight = pageHeight - 2 * options.margin
  const fit = Math.min(availableWidth / width, availableHeight / height)
  const scale = options.width === null ? fit : options.width / width
  if (!Number.isFinite(scale) || scale <= 0 || scale > fit + 0.000001) return null
  return {
    pageWidth,
    pageHeight,
    width: width * scale,
    height: height * scale,
    left: (pageWidth - width * scale) / 2,
    top: (pageHeight - height * scale) / 2,
    dpi: 25.4 / scale,
  }
}
