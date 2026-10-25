import { strToU8, zipSync } from 'fflate'
const image = strToU8(
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="orange"/></svg>',
)
const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
export const wordXml = (body: string) =>
  `<?xml version="1.0"?><w:document xmlns:w="${w}" xmlns:r="${r}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body>${body}</w:body></w:document>`
export const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
export const officeZip = (entries: Record<string, string | Uint8Array>) =>
  zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([path, value]) => [
        path,
        typeof value === 'string' ? strToU8(value) : value,
      ]),
    ),
  )
export function docxFixture(extra: Record<string, string | Uint8Array> = {}) {
  return officeZip({
    '[Content_Types].xml':
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="svg" ContentType="image/svg+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    '_rels/.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/document.xml':
      wordXml(`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Project overview</w:t></w:r></w:p>
      <w:p><w:r><w:t>Hello &amp; welcome. </w:t></w:r><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>Important note</w:t></w:r><w:del><w:r><w:delText>Deleted wording</w:delText></w:r></w:del></w:p>
      <w:p><w:hyperlink w:anchor="conclusion"><w:r><w:t>Jump to conclusion</w:t></w:r></w:hyperlink></w:p>
      <w:p><w:hyperlink r:id="link"><w:r><w:t>Documentation</w:t></w:r></w:hyperlink></w:p>
      <w:p><w:r><w:drawing><a:blip r:embed="picture"/></w:drawing></w:r></w:p>
      <w:p><w:r><w:drawing><a:blip r:link="remote-picture"/></w:drawing></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>${paragraph('Merged cell')}</w:tc><w:tc>${paragraph('42')}</w:tc></w:tr><w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr>${paragraph('')}</w:tc><w:tc>${paragraph('003')}</w:tc></w:tr></w:tbl>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>First task</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Second task</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:bookmarkStart w:id="1" w:name="conclusion"/><w:r><w:t>Conclusion</w:t></w:r></w:p>
      ${paragraph('Итоговый результат searchable conclusion')}
      <w:p><w:r><w:t>Reference</w:t><w:footnoteReference w:id="1"/></w:r></w:p>`),
    'word/styles.xml': `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:basedOn w:val="Heading1"/><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style></w:styles>`,
    'word/numbering.xml': `<w:numbering xmlns:w="${w}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
    'word/_rels/document.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="picture" Type="${r}/image" Target="media/example.svg"/><Relationship Id="remote-picture" Type="${r}/image" Target="https://external.invalid/track.png" TargetMode="External"/><Relationship Id="link" Type="${r}/hyperlink" Target="https://example.com/docs" TargetMode="External"/></Relationships>`,
    'word/footnotes.xml': `<w:footnotes xmlns:w="${w}"><w:footnote w:id="1">${paragraph('Footnote details')}</w:footnote></w:footnotes>`,
    'word/media/example.svg': image,
    'docProps/core.xml':
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Example document</dc:title><dc:creator>Ada</dc:creator></cp:coreProperties>',
    ...extra,
  })
}
export const odtXml = (body: string) =>
  `<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"><office:automatic-styles><style:style style:name="Bold" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style></office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`
export function odtFixture(extra: Record<string, string | Uint8Array> = {}) {
  return officeZip({
    mimetype: 'application/vnd.oasis.opendocument.text',
    'META-INF/manifest.xml':
      '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>',
    'content.xml': odtXml(
      '<text:h text:outline-level="1">Travel plan</text:h><text:p>Hello <text:span text:style-name="Bold">traveller</text:span><text:s text:c="3"/>next stop.</text:p><text:p><text:a xlink:href="#destination">Jump to destination</text:a></text:p><draw:frame><draw:image xlink:href="Pictures/example.svg"/></draw:frame><text:list><text:list-item><text:p>Pack a bag</text:p></text:list-item><text:list-item><text:p>Book train</text:p></text:list-item></text:list><table:table><table:table-row><table:table-cell table:number-columns-spanned="2"><text:p>Trip total</text:p></table:table-cell><table:covered-table-cell/></table:table-row><table:table-row><table:table-cell><text:p>Train</text:p></table:table-cell><table:table-cell><text:p>009</text:p></table:table-cell></table:table-row></table:table><text:section><text:h text:outline-level="2"><text:bookmark-start text:name="destination"/>Destination</text:h><text:p>Путешествие в Казань</text:p></text:section>',
    ),
    'Pictures/example.svg': image,
    'meta.xml':
      '<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><office:meta><dc:title>Travel document</dc:title></office:meta></office:document-meta>',
    ...extra,
  })
}
