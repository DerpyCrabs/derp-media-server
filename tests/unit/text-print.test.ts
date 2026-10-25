import { describe, expect, test } from 'bun:test'
import { markdownPrint } from '@/lib/printing/markdown-print'
import {
  buildTextPrint,
  countPrintLines,
  textPrintDefaults,
  textPrintHtml,
} from '@/lib/printing/text-print'
describe('text printing', () => {
  test('prints exact selected source lines with their original numbers and escaped markup', () => {
    const source = '\uFEFFfirst\r\n<script>alert(1)</script>\rthird\nlast'
    const output = buildTextPrint(source, '<file>.txt', {
      ...textPrintDefaults(false),
      range: 'lines',
      from: 2,
      to: 3,
      lineNumbers: true,
    })
    expect(countPrintLines(source)).toBe(4)
    expect(output.body).toContain('&lt;file&gt;.txt')
    expect(output.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(output.body).toContain('class="line-number">2</span>')
    expect(output.body).toContain('class="line-number">3</span>')
    expect(output.body).not.toContain('first')
    expect(output.body).not.toContain('last')
    expect(buildTextPrint('first\n', 'a', { ...textPrintDefaults(false), title: false }).body).toBe(
      '<pre class="source">first\n</pre>',
    )
  })
  test('large documents can print a bounded range without truncating or allocating every line', () => {
    const source = 'x\n'.repeat(100_000)
    expect(() => buildTextPrint(source, 'a', textPrintDefaults(false))).toThrow(
      'smaller line range',
    )
    const output = buildTextPrint(source, 'a', {
      ...textPrintDefaults(false),
      range: 'lines',
      from: 99999,
      to: 100000,
      title: false,
    })
    expect(output.body).toBe('<pre class="source">x\nx</pre>')
    expect(() => buildTextPrint('a', 'a', { ...textPrintDefaults(false), fontSize: NaN })).toThrow(
      'font size',
    )
    expect(() =>
      buildTextPrint('a', 'a', { ...textPrintDefaults(false), range: 'lines', from: 2, to: 1 }),
    ).toThrow('line range')
  })
  test('renders Markdown headings, lists, tasks, code and table cells independently of a viewport', () => {
    const output = markdownPrint(
      '# Title\n\n> **Important** and *emphasis*\n\n3. third\n4. fourth\n\n- [x] done\n- [ ] pending\n\n```html\n<b>literal</b>\n```\n\n| A | B |\n|---|---|\n|one|two|\n\n~~old~~ and ` value `',
    )
    expect(output.html).toContain('<h1>Title</h1>')
    expect(output.html).toContain(
      '<blockquote><p><strong>Important</strong> and <em>emphasis</em></p></blockquote>',
    )
    expect(output.html).toContain('<ol start="3">')
    expect(output.html).toContain('☑')
    expect(output.html).toContain('☐')
    expect(output.html).toContain('<pre><code>&lt;b&gt;literal&lt;/b&gt;</code></pre>')
    expect(output.html).toContain('<th>A</th>')
    expect(output.html).toContain('<td>two</td>')
    expect(output.html).toContain('<del>old</del>')
  })
  test('collects referenced and Obsidian images, with no executable raw HTML or unsafe links', () => {
    const output = markdownPrint(
      '[safe](https://example.com) [bad](javascript:alert)\n\n![first][asset]\n\n[asset]: <Images/a b.png>\n\n![[notes.png|Note image]]\n\n<script>bad()</script>\n\n<img src=x onerror=bad()>',
    )
    expect(output.images).toEqual([
      { source: 'Images/a b.png', alt: 'first' },
      { source: 'notes.png', alt: 'Note image' },
    ])
    expect(output.html).toContain('href="https://example.com"')
    expect(output.html).not.toContain('javascript:')
    expect(output.html).not.toContain('<script>')
    expect(output.html).not.toContain('<img src=')
    expect(output.html).toContain('&lt;script&gt;')
    expect(output.html).not.toContain('[asset]:')
  })
  test('page dimensions follow orientation and generated HTML blocks embedded scripts', () => {
    const output = buildTextPrint('hello', 'test', {
      ...textPrintDefaults(false),
      paper: 'letter',
      orientation: 'landscape',
      fontSize: 14,
    })
    expect(output.css).toContain('size:279.4mm 215.9mm')
    expect(output.css).toContain('14pt')
    const html = textPrintHtml('</title><script>bad()</script>', output.body, output.css)
    expect(html).toContain("default-src 'none'")
    expect(html).not.toContain('<script>')
  })
})
