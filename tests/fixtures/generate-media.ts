import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

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
