export function scopePdfViewerCss() {
  return {
    name: 'scope-pdf-viewer-css',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!id.replaceAll('\\', '/').endsWith('/pdfjs-dist/web/pdf_viewer.css')) return
      return {
        code: `@scope (.pdf-content) {\n${code.replaceAll(':root', ':scope')}\n}`,
        map: null,
      }
    },
  }
}
