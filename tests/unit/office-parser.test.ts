import { readFileSync } from 'node:fs'
import { getMediaTypeFromPath, getMimeType } from '@/lib/media/media-utils'
import { MediaType } from '@/lib/files/types'
import { expect, test } from 'bun:test'
import { parseOfficeDocument } from '@/features/reader/contentTypes/book/office-parser'
import {
  docxFixture,
  odtFixture,
  officeZip,
  wordXml,
  paragraph,
  odtXml,
} from '../fixtures/office-documents'
import { readResponseBytes } from '@/lib/files/response-bytes'

test('Word preview preserves heading hierarchy, inline formatting, lists, merged tables, images and cross-chapter bookmarks', () => {
  const document = parseOfficeDocument(docxFixture(), 'REPORT.DOCX')
  expect(document.metadata).toEqual({ title: 'Example document', authors: ['Ada'] })
  expect(document.outline[0]?.children[0]?.label).toBe('Conclusion')
  const markup = document.chapters.map((chapter) => chapter.markup).join('')
  expect(markup).toContain('<em><strong>Important note</strong></em>')
  expect(markup).not.toContain('Deleted wording')
  expect(markup).toContain('rowspan="2"')
  expect(markup).toContain('<ol start="2"')
  expect(markup).toContain('href="document-section-1.xhtml#conclusion"')
  expect(markup).toContain('Footnote details')
  expect(document.resources.map((resource) => resource.path)).toEqual(['word/media/example.svg'])
  expect(markup).not.toContain('https://external.invalid')
  expect(document.notices).toContain('Some linked or unsupported images are omitted.')
})

test('ODT preview preserves section headings, tables, lists, styled text, whitespace and embedded images', () => {
  const document = parseOfficeDocument(odtFixture(), 'travel.odt')
  expect(document.outline[0]?.children[0]?.label).toBe('Destination')
  const markup = document.chapters.map((chapter) => chapter.markup).join('')
  expect(markup).toContain('<strong>traveller</strong>   next stop.')
  expect(markup).toContain('colspan="2"')
  expect(markup).toContain('<ul><li>')
  expect(markup).toContain('href="document-section-1.xhtml#destination"')
  expect(document.resources).toHaveLength(1)
})

test('document packages reject ambiguous paths, entity expansion, encryption and excessive nesting', () => {
  expect(() => parseOfficeDocument(officeZip({ '../escape': 'x' }), 'bad.docx')).toThrow(
    'ambiguous',
  )
  expect(() =>
    parseOfficeDocument(
      docxFixture({
        'word/document.xml':
          '<!DOCTYPE document [<!ENTITY x "value">]>' + wordXml(paragraph('&x;')),
      }),
      'bad.docx',
    ),
  ).toThrow('entity declarations')
  expect(() =>
    parseOfficeDocument(
      odtFixture({ 'META-INF/manifest.xml': '<manifest><encryption-data/></manifest>' }),
      'bad.odt',
    ),
  ).toThrow('Encrypted')
  expect(() =>
    parseOfficeDocument(
      docxFixture({
        'word/document.xml': wordXml(
          '<w:customXml>'.repeat(130) + paragraph('nested') + '</w:customXml>'.repeat(130),
        ),
      }),
      'bad.docx',
    ),
  ).toThrow('complex')
  expect(() => parseOfficeDocument(new Uint8Array(64), 'encrypted.docx')).toThrow(
    'damaged or encrypted',
  )
})

test('document package limits apply before decompression and repeated table expansion is bounded', () => {
  const bytes = docxFixture()
  const changed = bytes.slice(),
    view = new DataView(changed.buffer)
  for (let offset = 0; offset < changed.length - 46; offset++)
    if (view.getUint32(offset, true) === 0x02014b50) {
      view.setUint32(offset + 24, 17 * 1024 * 1024, true)
      break
    }
  expect(() => parseOfficeDocument(changed, 'bad.docx')).toThrow('expanded document')
  const repeated = odtXml(
    '<table:table><table:table-row table:number-rows-repeated="1000"><table:table-cell table:number-columns-repeated="1000"><text:p>' +
      'x'.repeat(3000) +
      '</text:p></table:table-cell></table:table-row></table:table>',
  )
  expect(() => parseOfficeDocument(odtFixture({ 'content.xml': repeated }), 'bad.odt')).toThrow(
    'preview limit',
  )
})

test('bounded downloads reject oversized headers and streaming bodies, releasing the reader', async () => {
  expect(
    String(
      await readResponseBytes(
        new Response('small', { headers: { 'content-length': '100' } }),
        20,
      ).catch((error) => error),
    ),
  ).toContain('preview limit')
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(12))
    },
    cancel() {
      cancelled = true
    },
  })
  expect(String(await readResponseBytes(new Response(body), 20).catch((error) => error))).toContain(
    'preview limit',
  )
  expect(cancelled).toBe(true)
  expect(new TextDecoder().decode(await readResponseBytes(new Response('ok'), 20))).toBe('ok')
})

test('office files use document viewers while macro-enabled and legacy formats stay distinct', () => {
  expect(getMediaTypeFromPath('Documents/REPORT.DOCX')).toBe(MediaType.DOCUMENT)
  expect(getMediaTypeFromPath('Documents/report.odt')).toBe(MediaType.DOCUMENT)
  expect(getMediaTypeFromPath('Documents/report.docm')).toBe(MediaType.OTHER)
  expect(getMimeType('docx')).toBe(
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  )
  expect(getMimeType('odt')).toBe('application/vnd.oasis.opendocument.text')
})

test('documents produced by python-docx and LibreOffice retain the same readable contents', () => {
  for (const extension of ['docx', 'odt']) {
    const document = parseOfficeDocument(
      readFileSync(`tests/fixtures/office-report.${extension}`),
      `report.${extension}`,
    )
    expect(document.metadata.title).toBe('Weekly report')
    expect(document.outline.map((item) => item.label)).toEqual(['Overview', 'Next steps'])
    expect(document.resources).toHaveLength(1)
    const markup = document.chapters.map((chapter) => chapter.markup).join('')
    for (const text of [
      'Работа над проектом',
      'First numbered item',
      'Second numbered item',
      'A bullet item',
      'Media server',
      'In progress',
    ])
      expect(markup).toContain(text)
    expect(markup).toContain('<ol ')
    expect(markup).toContain('<ul')
  }
})

test('ODT footnotes remain separate from paragraph text and link to their note section', () => {
  const document = parseOfficeDocument(
    odtFixture({
      'content.xml': odtXml(
        '<text:p>Body<text:note><text:note-citation>1</text:note-citation><text:note-body><text:p>Explanation</text:p></text:note-body></text:note> continues.</text:p>',
      ),
    }),
    'note.odt',
  )
  expect(document.chapters[0]?.markup).toContain('href="document-section-1.xhtml#odt-footnote-0"')
  expect(document.chapters[0]?.markup).not.toContain('Explanation')
  expect(document.chapters[1]?.markup).toContain('Explanation')
})
