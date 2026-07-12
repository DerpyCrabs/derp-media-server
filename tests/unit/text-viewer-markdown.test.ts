import { expect, test } from 'bun:test'
import { createMarkdownRenderer } from '@/src/media/text-viewer-markdown'

test('readonly markdown preserves single source line breaks', () => {
  const renderer = createMarkdownRenderer(() => null)
  const html = renderer.render('first line\nsecond line\nthird line')

  expect(html).toContain('first line<br>')
  expect(html).toContain('second line<br>')
  expect(html).toContain('third line')
})
