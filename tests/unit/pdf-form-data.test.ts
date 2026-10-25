import { expect, test } from 'bun:test'
import { parsePdfFormValues } from '../../src/features/reader/contentTypes/pdf/pdf-form-data'
test('form drafts retain false, empty fields and multiple choices without accepting arbitrary objects', () => {
  const values = {
    a: { name: 'Name', value: '' },
    b: { name: 'Consent', value: false },
    c: { name: 'Choices', value: ['One', 'Two'] },
  }
  expect(parsePdfFormValues(JSON.stringify(values))).toEqual(values)
  for (const input of [
    'null',
    '[]',
    '{"a":{"name":"A","value":null}}',
    '{"a":{"name":"A","value":{"script":"x"}}}',
    '{"a":{"value":"x"}}',
    '{"a":{"name":"A","value":[1]}}',
  ])
    expect(parsePdfFormValues(input)).toBeNull()
  const special = parsePdfFormValues('{"__proto__":{"name":"Field","value":"entry"}}')
  expect(special?.['__proto__']?.value).toBe('entry')
  expect(Object.getPrototypeOf(special)).toBeNull()
})
