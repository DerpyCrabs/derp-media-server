import { expect, test } from 'bun:test'
import { detectCodeLanguage, detectIndentation } from '../../src/lib/editor/code-languages'
test('code language detection covers configuration names, filename extensions and executable scripts', () => {
  expect(detectCodeLanguage('home/.bashrc')).toBe('shell')
  expect(detectCodeLanguage('home/PKGBUILD')).toBe('shell')
  expect(detectCodeLanguage('home/.env.local')).toBe('ini')
  expect(detectCodeLanguage('home/service.TOML')).toBe('toml')
  expect(detectCodeLanguage('home/.editorconfig')).toBe('ini')
  expect(detectCodeLanguage('code/main.tsx')).toBe('typescript')
  expect(detectCodeLanguage('bin/tool', '#!/usr/bin/env python3\nprint(1)')).toBe('python')
  expect(detectCodeLanguage('bin/tool', '#!/bin/bash\necho ok')).toBe('shell')
  expect(detectCodeLanguage('notes.txt', 'just words')).toBe('plain')
})
test('indentation detection respects tab-based and nested space-based files', () => {
  expect(detectIndentation('a\n\tb\n\t\tc')).toBe('tabs')
  expect(detectIndentation('{\n    "a": {\n        "b": 1\n    }\n}')).toBe('4')
  expect(detectIndentation('root:\n  child:\n    value: 1\n')).toBe('2')
  expect(detectIndentation('root:\n        value: 1\n')).toBe('8')
  expect(detectIndentation('no indentation')).toBe('2')
})
