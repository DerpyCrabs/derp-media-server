import { beforeEach, describe, expect, test } from 'bun:test'
import {
  buildShareUrl,
  clearCapturedSharePasscodesForTests,
  inspectSharePasscode,
} from '../../src/lib/share-url'

describe('share passcode URL compatibility', () => {
  beforeEach(clearCapturedSharePasscodesForTests)

  test('scrubs legacy query secret and preserves other URL state', () => {
    const result = inspectSharePasscode(
      new URL('https://desk.test/share/token?p=old%20secret&dir=Docs#page=4'),
    )
    expect(result).toEqual({
      token: 'token',
      passcode: 'old secret',
      sanitizedHref: 'https://desk.test/share/token?dir=Docs#page=4',
      changed: true,
    })
  })

  test('fragment secret wins and both secret locations are scrubbed', () => {
    const result = inspectSharePasscode(
      new URL('https://desk.test/share/token/workspace?p=legacy&ws=a#p=new%2Bcode&pane=2'),
    )
    expect(result.passcode).toBe('new+code')
    expect(result.sanitizedHref).toBe('https://desk.test/share/token/workspace?ws=a#pane=2')
  })

  test('malformed encoding stays usable and never blocks scrubbing', () => {
    const result = inspectSharePasscode(new URL('https://desk.test/share/token#p=%25ZZ&x=1'))
    expect(result.passcode).toBe('%ZZ')
    expect(result.sanitizedHref).toBe('https://desk.test/share/token#x=1')
  })

  test('non-share URLs are untouched', () => {
    const href = 'https://desk.test/library?p=owner#p=fragment'
    expect(inspectSharePasscode(new URL(href))).toEqual({
      token: null,
      passcode: null,
      sanitizedHref: href,
      changed: false,
    })
  })

  test('first compatibility release still generates legacy query links', () => {
    expect(buildShareUrl({ token: 'abc', passcode: 'a b' }, 'https://desk.test/')).toBe(
      'https://desk.test/share/abc?p=a%20b',
    )
  })
})
