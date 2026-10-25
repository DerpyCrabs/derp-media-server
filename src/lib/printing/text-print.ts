import { escapePrintHtml, markdownPrint, type PrintImage } from './markdown-print'
export type TextPrintOptions = {
  paper: 'a4' | 'letter'
  orientation: 'portrait' | 'landscape'
  fontSize: number
  lineNumbers: boolean
  format: 'source' | 'markdown'
  range: 'all' | 'lines'
  from: number
  to: number
  title: boolean
}
export const textPrintDefaults = (markdown: boolean): TextPrintOptions => ({
  paper: 'a4',
  orientation: 'portrait',
  fontSize: 11,
  lineNumbers: false,
  format: markdown ? 'markdown' : 'source',
  range: 'all',
  from: 1,
  to: 1,
  title: true,
})
export const countPrintLines = (source: string) => {
  let count = 1
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') count++
    else if (source[i] === '\r') {
      count++
      if (source[i + 1] === '\n') i++
    }
  }
  return count
}
export function buildTextPrint(source: string, name: string, options: TextPrintOptions) {
  if (!Number.isFinite(options.fontSize) || options.fontSize < 8 || options.fontSize > 24)
    throw new Error('Choose a font size between 8 and 24 points.')
  const lineCount = countPrintLines(source)
  const start = options.range === 'all' ? 1 : options.from,
    end = options.range === 'all' ? lineCount : options.to
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 1 ||
    start > end ||
    end > lineCount
  )
    throw new Error(`Choose a line range between 1 and ${lineCount}.`)
  const tooLarge = () =>
    new Error('Choose a smaller line range: printing supports up to 2 MB and 20,000 lines at once.')
  if (end - start + 1 > 20_000 || (options.range === 'all' && source.length > 2_097_152))
    throw tooLarge()
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n|\r/g, '\n')
  let from = 0,
    to = normalized.length
  for (let line = 1, at = 0; line <= end; line++) {
    if (line === start) from = at
    const next = normalized.indexOf('\n', at)
    if (line === end) {
      to = next < 0 ? normalized.length : next
      break
    }
    at = next + 1
  }
  if (to - from > 2_097_152) throw tooLarge()
  const text = normalized.slice(from, to),
    selected = text.split('\n')
  let images: PrintImage[] = [],
    body: string
  if (options.format === 'markdown') {
    const result = markdownPrint(text)
    body = `<article>${result.html}</article>`
    images = result.images
  } else if (options.lineNumbers)
    body = `<div class="source numbered">${selected.map((line, index) => `<div class="source-line"><span class="line-number">${start + index}</span><span>${escapePrintHtml(line) || '&#8203;'}</span></div>`).join('')}</div>`
  else body = `<pre class="source">${escapePrintHtml(text)}</pre>`
  const width = options.paper === 'letter' ? 215.9 : 210,
    height = options.paper === 'letter' ? 279.4 : 297
  const pageWidth = options.orientation === 'landscape' ? height : width
  const pageHeight = options.orientation === 'landscape' ? width : height
  const css = `@page{size:${pageWidth}mm ${pageHeight}mm;margin:12mm}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#111}body{font:${options.fontSize}pt/1.5 Arial,sans-serif;overflow-wrap:anywhere}header{font:9pt/1.4 Arial,sans-serif;border-bottom:1px solid #bbb;padding-bottom:4mm;margin-bottom:6mm;color:#555}h1,h2,h3,h4,h5,h6{break-after:avoid;line-height:1.2;margin:1em 0 .4em}h1{font-size:1.9em}h2{font-size:1.5em}h3{font-size:1.2em}p{margin:.5em 0;orphans:3;widows:3}ul,ol{padding-left:1.8em}li>p{margin:.2em 0}blockquote{border-left:3px solid #bbb;margin:.8em 0;padding-left:1em}pre,code,.source{font-family:"Courier New",monospace;font-size:inherit;tab-size:4}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:.6em 0}article pre{padding:.6em;border:1px solid #ccc;background:#f5f5f5}code{background:#f5f5f5}pre code{background:none}table{border-collapse:collapse;width:100%;margin:.8em 0}th,td{border:1px solid #aaa;padding:.35em .5em;text-align:left;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}img{display:block;max-width:100%;max-height:${pageHeight - 34}mm;width:auto;height:auto;object-fit:contain;margin:.5em 0;break-inside:avoid}a{color:#1751a6;text-decoration:underline}.source{white-space:pre-wrap;overflow-wrap:anywhere}.source-line{display:grid;grid-template-columns:5ch minmax(0,1fr);gap:1ch}.line-number{text-align:right;color:#777;user-select:none;white-space:normal}.missing-image{display:inline-block;border:1px dashed #aaa;color:#666;padding:.5em}.task{font-family:Arial,sans-serif}hr{border:0;border-top:1px solid #aaa;margin:1em 0}@media screen{html{background:#ddd}body{width:${pageWidth}mm;min-height:${pageHeight}mm;padding:12mm;margin:8px auto;box-shadow:0 1px 5px #aaa}}`
  return {
    body: `${options.title ? `<header>${escapePrintHtml(name)}</header>` : ''}${body}`,
    css,
    images,
    lineCount,
  }
}
export function textPrintHtml(title: string, body: string, css: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src http: https: blob: data:; style-src 'unsafe-inline'"><title>${escapePrintHtml(title)}</title><style>${css}</style></head><body>${body}</body></html>`
}
