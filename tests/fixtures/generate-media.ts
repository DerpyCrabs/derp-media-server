import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { strToU8, zipSync } from 'fflate'

// Minimal valid 1x1 JPEG
const MINIMAL_JPEG = Buffer.from(
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwg' +
    'IyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgo' +
    'KCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QA' +
    'FQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAA' +
    'AAAAAAAAAABgj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABykX//Z',
  'base64',
)

// Minimal valid 1x1 PNG (red pixel)
const MINIMAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/Pch' +
    'I7wAAAABJRU5ErkJggg==',
  'base64',
)

const EPUB_FIXTURE = Buffer.from(
  zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(
      '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    'EPUB/package.opf': strToU8(
      '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Reader EPUB Fixture</dc:title><dc:creator>Test Author</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="front" href="front.xhtml" media-type="application/xhtml+xml"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="style" href="styles/book.css" media-type="text/css"/><item id="font" href="fonts/fixture.woff" media-type="font/woff"/></manifest><spine><itemref idref="front"/><itemref idref="one"/><itemref idref="two"/></spine></package>',
    ),
    'EPUB/nav.xhtml': strToU8(
      '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="one.xhtml">Opening</a></li><li><a href="two.xhtml">Second chapter</a></li></ol></nav></body></html>',
    ),
    'EPUB/front.xhtml': strToU8(
      '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p>Front matter outside the table of contents.</p></body></html>',
    ),
    'EPUB/one.xhtml': strToU8(
      '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><section id="opening"><p class="chapter-title">Opening body without semantic heading</p><p>Selectable EPUB text begins here.</p>' +
        '<p>Long chapter content used to verify exact reading position restoration.</p>'.repeat(
          40,
        ) +
        '<script>alert("unsafe")</script><form><input value="unsafe"/></form><img src="https://example.invalid/tracker.png"/><p><a href="two.xhtml#destination">Continue internally</a></p></section></body></html>',
    ),
    'EPUB/two.xhtml': strToU8(
      '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><section id="destination"><h1>Second chapter</h1><p>EPUB destination text.</p></section></body></html>',
    ),
    'EPUB/styles/book.css': strToU8(
      '@font-face { font-family: "Fixture Font"; src: url("../fonts/fixture.woff") format("woff"); font-weight: 400; } body { font-family: "Fixture Font"; font-size: 13px; background-color: rgb(255, 0, 0) !important; color: rgb(0, 255, 0) !important; }',
    ),
    'EPUB/fonts/fixture.woff': new Uint8Array([0x77, 0x4f, 0x46, 0x46]),
  }),
)

const FB2_FIXTURE = Buffer.from(
  '<?xml version="1.0" encoding="UTF-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><genre>fiction</genre><author><first-name>Test</first-name><last-name>Author</last-name></author><book-title>Reader FB2 Fixture</book-title><lang>en</lang></title-info></description><body><section id="first"><title><p>First section</p></title><p>Selectable FB2 text begins here.</p><section id="nested"><title><p>Nested section</p></title><p>Nested FB2 content.</p></section></section></body></FictionBook>',
)

function writeBookFixtures(directory: string) {
  fs.writeFileSync(path.join(directory, 'reader.epub'), EPUB_FIXTURE)
  fs.writeFileSync(path.join(directory, 'reader-switch.epub'), EPUB_FIXTURE)
  fs.writeFileSync(path.join(directory, 'reader-position.epub'), EPUB_FIXTURE)
  fs.writeFileSync(path.join(directory, 'reader.fb2'), FB2_FIXTURE)
  fs.writeFileSync(
    path.join(directory, 'reader.fb2.zip'),
    Buffer.from(zipSync({ 'reader.fb2': FB2_FIXTURE })),
  )
}

function pdfPages(pages: string[][]): Buffer {
  const streams = pages.map((lines) =>
    lines
      .map(
        (line, index) =>
          `BT /F1 24 Tf 72 ${720 - index * 34} Td (${line.replace(/([\\()])/g, '\\$1')}) Tj ET`,
      )
      .join('\n'),
  )
  const fontObjectId = 3 + streams.length * 2
  const pageObjects = streams.map((stream, index) => {
    const pageObjectId = 3 + index * 2
    const contentObjectId = pageObjectId + 1
    return {
      page: `${pageObjectId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>\nendobj\n`,
      content: `${contentObjectId} 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj\n`,
      pageObjectId,
    }
  })
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjects.map(({ pageObjectId }) => `${pageObjectId} 0 R`).join(' ')}] /Count ${streams.length} >>\nendobj\n`,
    ...pageObjects.flatMap(({ page, content }) => [page, content]),
    `${fontObjectId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`,
  ]
  let body = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object) => {
    offsets.push(Buffer.byteLength(body))
    body += object
  })
  const xrefOffset = Buffer.byteLength(body)
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  body += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return Buffer.from(body)
}

const MINIMAL_PDF = pdfPages([['Selectable PDF text']])
export const READER_PDF = pdfPages([
  [
    'Selectable reader text begins here',
    'Second selected line continues the passage',
    'Third selected line keeps the block compact',
    'Fourth selected line ends the selected block',
  ],
  ['Reader position anchor page 2'],
  ['Reader position anchor page 3'],
  ['Reader position anchor page 4'],
])

function hasFfmpeg(): boolean {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function run(cmd: string, cwd: string) {
  execSync(cmd, { stdio: 'ignore', cwd, timeout: 30_000 })
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
}

/** Text fixtures added after `.test-media-cache` copy so e2e always sees current files. */
const AUTOSAVE_PARITY_TXT_CONTENT = 'Autosave parity initial content for e2e only.\n'
const MARKDOWN_EDITOR_MD_CONTENT =
  '# Todo List\n\n- [ ] First task\n- [ ] Second task\n- [x] Done task\n'

export function patchTestMediaAfterCacheCopy(baseDir: string) {
  const documentsDir = path.join(baseDir, 'Documents')
  ensureDir(documentsDir)
  fs.writeFileSync(path.join(documentsDir, 'reader-workspace.pdf'), READER_PDF)
  fs.writeFileSync(path.join(documentsDir, 'reader.pdf'), READER_PDF)
  writeBookFixtures(documentsDir)

  const notesDir = path.join(baseDir, 'Notes')
  ensureDir(notesDir)
  fs.writeFileSync(path.join(notesDir, 'autosave-parity.txt'), AUTOSAVE_PARITY_TXT_CONTENT)
  fs.writeFileSync(path.join(notesDir, 'markdown-editor-e2e.md'), MARKDOWN_EDITOR_MD_CONTENT)

  const deepDir = path.join(notesDir, 'subfolder', 'breadcrumb-deep')
  ensureDir(deepDir)
  fs.writeFileSync(
    path.join(deepDir, 'deep-readme.txt'),
    'Fixture for breadcrumb depth / ellipsis e2e tests.\n',
  )

  const deepChain = ['seg-a', 'seg-b', 'seg-c', 'breadcrumb-deep']
  let chainPath = notesDir
  for (const part of deepChain) {
    chainPath = path.join(chainPath, part)
    ensureDir(chainPath)
  }
  fs.writeFileSync(
    path.join(chainPath, 'chain-readme.txt'),
    'Fixture for deep breadcrumb ellipsis e2e tests.\n',
  )
}

export function generateTestMedia(baseDir: string) {
  const ff = hasFfmpeg()
  if (!ff) {
    console.warn('WARNING: ffmpeg not found — video/audio files will not be generated.')
    console.warn('Install ffmpeg for full test coverage.')
  }

  // --- Videos ---
  const videosDir = path.join(baseDir, 'Videos')
  ensureDir(videosDir)
  if (ff) {
    run(
      'ffmpeg -y -f lavfi -i color=black:s=320x240:d=2 -f lavfi -i anullsrc=r=44100:cl=mono -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac sample.mp4',
      videosDir,
    )
    try {
      run(
        'ffmpeg -y -f lavfi -i color=black:s=320x240:d=2 -f lavfi -i anullsrc=r=44100:cl=mono -shortest -c:v libvpx -c:a libvorbis sample.webm',
        videosDir,
      )
    } catch {
      console.warn('  Could not generate WebM (libvpx unavailable), skipping')
    }
  }

  // --- Music ---
  const musicDir = path.join(baseDir, 'Music')
  ensureDir(musicDir)
  if (ff) {
    run('ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 2 -c:a libmp3lame track.mp3', musicDir)
    run('ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 2 track.flac', musicDir)
  }
  fs.writeFileSync(path.join(musicDir, 'cover.jpg'), MINIMAL_JPEG)

  // --- Images ---
  const imagesDir = path.join(baseDir, 'Images')
  ensureDir(imagesDir)
  fs.writeFileSync(path.join(imagesDir, 'photo.jpg'), MINIMAL_JPEG)
  fs.writeFileSync(path.join(imagesDir, 'photo.png'), MINIMAL_PNG)

  // --- Documents (read-only) ---
  const docsDir = path.join(baseDir, 'Documents')
  ensureDir(docsDir)
  fs.writeFileSync(
    path.join(docsDir, 'readme.txt'),
    'This is a test readme file.\nIt has multiple lines.\nLine three.\n',
  )
  fs.writeFileSync(path.join(docsDir, 'résumé 日本.txt'), 'Unicode offline content.\n')
  fs.writeFileSync(
    path.join(docsDir, 'notes.md'),
    '# Test Notes\n\nThis is a **markdown** file with [a link](https://example.com).\n\n## Section Two\n\nMore content here.\n',
  )
  fs.writeFileSync(
    path.join(docsDir, 'image-note.md'),
    '# Image Note\n\n![photo](Images/photo.jpg)\n',
  )
  fs.writeFileSync(
    path.join(docsDir, 'data.json'),
    JSON.stringify({ name: 'test', items: [1, 2, 3] }, null, 2),
  )
  fs.writeFileSync(path.join(docsDir, 'sample.pdf'), MINIMAL_PDF)
  fs.writeFileSync(path.join(docsDir, 'reader-workspace.pdf'), READER_PDF)
  fs.writeFileSync(path.join(docsDir, 'reader.pdf'), READER_PDF)
  writeBookFixtures(docsDir)
  // Unsupported type for workspace "modal inside window" e2e test
  fs.writeFileSync(path.join(docsDir, 'unsupported.xyz'), Buffer.from('test'))

  // --- Notes (editable + KB) ---
  const notesDir = path.join(baseDir, 'Notes')
  ensureDir(path.join(notesDir, 'images'))
  ensureDir(path.join(notesDir, 'subfolder'))
  fs.writeFileSync(
    path.join(notesDir, 'welcome.md'),
    '# Welcome\n\nThis is the welcome note.\n\n![[diagram.png]]\n',
  )
  fs.writeFileSync(path.join(notesDir, 'todo.md'), MARKDOWN_EDITOR_MD_CONTENT)
  fs.writeFileSync(path.join(notesDir, 'markdown-editor-e2e.md'), MARKDOWN_EDITOR_MD_CONTENT)
  fs.writeFileSync(path.join(notesDir, 'autosave-parity.txt'), AUTOSAVE_PARITY_TXT_CONTENT)
  fs.writeFileSync(
    path.join(notesDir, 'subfolder', 'nested-note.md'),
    '# Nested Note\n\nThis is a nested note inside a subfolder.\n',
  )
  ensureDir(path.join(notesDir, 'subfolder', 'breadcrumb-deep'))
  fs.writeFileSync(
    path.join(notesDir, 'subfolder', 'breadcrumb-deep', 'deep-readme.txt'),
    'Fixture for breadcrumb depth / ellipsis e2e tests.\n',
  )
  const deepChain = ['seg-a', 'seg-b', 'seg-c', 'breadcrumb-deep']
  let chainPath = notesDir
  for (const part of deepChain) {
    chainPath = path.join(chainPath, part)
    ensureDir(chainPath)
  }
  fs.writeFileSync(
    path.join(chainPath, 'chain-readme.txt'),
    'Fixture for deep breadcrumb ellipsis e2e tests.\n',
  )
  fs.writeFileSync(path.join(notesDir, 'images', 'diagram.png'), MINIMAL_PNG)

  // --- SharedContent (editable, for share tests) ---
  const sharedDir = path.join(baseDir, 'SharedContent')
  ensureDir(path.join(sharedDir, 'subfolder'))
  fs.writeFileSync(
    path.join(sharedDir, 'public-doc.txt'),
    'This is a public document for share testing.\n',
  )
  fs.writeFileSync(
    path.join(sharedDir, 'subfolder', 'nested.txt'),
    'Nested file in shared content.\n',
  )
  fs.writeFileSync(path.join(sharedDir, 'photo.jpg'), MINIMAL_JPEG)
  fs.writeFileSync(path.join(sharedDir, 'photo.png'), MINIMAL_PNG)
  fs.writeFileSync(path.join(sharedDir, 'sample.pdf'), MINIMAL_PDF)
  writeBookFixtures(sharedDir)
  fs.writeFileSync(path.join(sharedDir, 'cover.jpg'), MINIMAL_JPEG)
  if (ff) {
    run(
      'ffmpeg -y -f lavfi -i color=black:s=320x240:d=2 -f lavfi -i anullsrc=r=44100:cl=mono -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac public-video.mp4',
      sharedDir,
    )
    run('ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 2 -c:a libmp3lame track.mp3', sharedDir)
  }

  // --- EmptyFolder ---
  ensureDir(path.join(baseDir, 'EmptyFolder'))
}
