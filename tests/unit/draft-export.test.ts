import { describe, expect, test } from 'bun:test'
import {
  draftText,
  exportDocumentDraft,
  recoveredFileName,
} from '../../src/lib/editor/draft-export'
import type { DocumentDraft } from '../../src/lib/editor/document-drafts'
const draft: DocumentDraft = {
  id: 'one',
  path: 'Notes/file.txt',
  kind: 'text',
  content: '\ufeffone\r\ntwo\rthree\n',
  version: '',
  updatedAt: 1,
}
describe('draft export', () => {
  test('text exports preserve BOM and exact mixed line endings', async () => {
    const bytes = new Uint8Array(await (await exportDocumentDraft(draft)).arrayBuffer())
    expect(bytes).toEqual(new TextEncoder().encode(draft.content))
  })
  test('recovered names keep text extensions, image output type and Unicode graphemes within filesystem limits', () => {
    expect(recoveredFileName(draft)).toBe('file-recovered.txt')
    expect(recoveredFileName({ path: 'Notes/.env' })).toBe('.env-recovered')
    expect(recoveredFileName({ path: 'Photos/photo.jpg', kind: 'image' })).toBe(
      'photo-recovered.png',
    )
    expect(recoveredFileName({ path: 'Forms/form.pdf', kind: 'pdf' })).toBe('form-recovered.json')
    const name = recoveredFileName({ path: `Notes/${'👩🏽‍💻'.repeat(40)}.txt` })
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(255)
    expect(name.replace('-recovered.txt', '').length % '👩🏽‍💻'.length).toBe(0)
  })
  test('form backups preserve field names and values and invalid backups fail explicitly', () => {
    const content = JSON.stringify({
      a: { name: 'Имя', value: 'Мария' },
      b: { name: 'Checked', value: true },
    })
    expect(JSON.parse(draftText({ ...draft, kind: 'pdf', content }))).toEqual(JSON.parse(content))
    expect(() => draftText({ ...draft, kind: 'pdf', content: '{broken' })).toThrow('invalid')
    expect(() => draftText({ ...draft, kind: 'reader-note', content: '{}' })).toThrow('invalid')
  })
})
