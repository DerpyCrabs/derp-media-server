import { expect, test } from 'bun:test'
import { fileIconKind } from '@/features/explorer/file-icon-kind'

test('file icons distinguish common desktop formats regardless of case', () => {
  for (const [path, kind] of [
    ['Backup.TAR.GZ', 'archive'],
    ['code.TSX', 'code'],
    ['settings.yaml', 'config'],
    ['.env.local', 'config'],
    ['run.SH', 'script'],
    ['main.py', 'script'],
    ['App.AppImage', 'program'],
    ['table.xlsx', 'spreadsheet'],
    ['slides.odp', 'presentation'],
    ['data.sqlite3', 'database'],
    ['font.woff2', 'font'],
    ['app.deb', 'package'],
    ['Dockerfile', 'code'],
  ])
    expect(fileIconKind(path!)).toBe(kind)
  expect(fileIconKind('/bin/tool', true)).toBe('program')
  for (const path of ['book.fb2.zip', 'photo.png', 'song.mp3', 'note.txt', 'unknown'])
    expect(fileIconKind(path)).toBeUndefined()
})
