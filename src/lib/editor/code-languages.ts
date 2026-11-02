import type { Extension } from '@codemirror/state'
import { StreamLanguage } from '@codemirror/language'
export const codeLanguages = [
  ['plain', 'Plain text'],
  ['cpp', 'C / C++'],
  ['css', 'CSS'],
  ['html', 'HTML'],
  ['ini', 'INI / Properties'],
  ['javascript', 'JavaScript / JSX'],
  ['json', 'JSON'],
  ['python', 'Python'],
  ['rust', 'Rust'],
  ['shell', 'Shell'],
  ['sql', 'SQL'],
  ['toml', 'TOML'],
  ['typescript', 'TypeScript / TSX'],
  ['xml', 'XML'],
  ['yaml', 'YAML'],
] as const
export type CodeLanguage = (typeof codeLanguages)[number][0]
export function detectCodeLanguage(path: string, content = ''): CodeLanguage {
  const name = path.split(/[\\/]/).at(-1)?.toLowerCase() ?? ''
  if (/^(\.?(bashrc|bash_profile|zshrc|zprofile|profile)|pkgbuild)$/.test(name)) return 'shell'
  if (/^(\.env(?:\..*)?|\.gitconfig|\.editorconfig)$/.test(name)) return 'ini'
  const extension = name.split('.').at(-1) ?? ''
  const mapping: Record<string, CodeLanguage> = {
    c: 'cpp',
    h: 'cpp',
    cc: 'cpp',
    cpp: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    css: 'css',
    html: 'html',
    htm: 'html',
    ini: 'ini',
    cfg: 'ini',
    conf: 'ini',
    service: 'ini',
    desktop: 'ini',
    properties: 'ini',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    jsonc: 'json',
    py: 'python',
    pyw: 'python',
    rs: 'rust',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    fish: 'shell',
    sql: 'sql',
    toml: 'toml',
    ts: 'typescript',
    tsx: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    xml: 'xml',
    svg: 'xml',
    xsl: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
  }
  if (mapping[extension]) return mapping[extension]
  const first = content.slice(0, 256).split(/[\r\n]/)[0] ?? ''
  if (first.startsWith('#!')) {
    if (/\bpython[\d.]*(?:\s|$)/.test(first)) return 'python'
    if (/\b(?:ba|z|da|fi)?sh(?:\s|$)/.test(first)) return 'shell'
    if (/\b(?:node|bun|deno)(?:\s|$)/.test(first)) return 'javascript'
  }
  return 'plain'
}
export function detectIndentation(content: string): 'tabs' | '2' | '4' | '8' {
  const counts = { tabs: 0, '2': 0, '4': 0, '8': 0 }
  for (const line of content
    .slice(0, 100_000)
    .split(/\r\n|\r|\n/)
    .slice(0, 1000)) {
    if (/^\t+\S/.test(line)) counts.tabs++
    else {
      const width = /^ +(?=\S)/.exec(line)?.[0].length ?? 0
      if (width && width % 2 === 0) {
        if (width % 8 === 0) counts['8']++
        else if (width % 4 === 0) counts['4']++
        else counts['2']++
      }
    }
  }
  if (counts.tabs > counts['2'] + counts['4'] + counts['8']) return 'tabs'
  if (counts['2']) return '2'
  if (counts['4']) return '4'
  return counts['8'] ? '8' : '2'
}
export async function loadCodeLanguage(language: CodeLanguage, path: string): Promise<Extension> {
  switch (language) {
    case 'cpp':
      return (await import('@codemirror/lang-cpp')).cpp()
    case 'css':
      return (await import('@codemirror/lang-css')).css()
    case 'html':
      return (await import('@codemirror/lang-html')).html()
    case 'ini':
      return StreamLanguage.define(
        (await import('@codemirror/legacy-modes/mode/properties')).properties,
      )
    case 'javascript':
      return (await import('@codemirror/lang-javascript')).javascript({ jsx: true })
    case 'json':
      return (await import('@codemirror/lang-json')).json()
    case 'python':
      return (await import('@codemirror/lang-python')).python()
    case 'rust':
      return (await import('@codemirror/lang-rust')).rust()
    case 'shell':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/shell')).shell)
    case 'sql':
      return (await import('@codemirror/lang-sql')).sql()
    case 'toml':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/toml')).toml)
    case 'typescript':
      return (await import('@codemirror/lang-javascript')).javascript({
        typescript: true,
        jsx: /\.tsx$/i.test(path),
      })
    case 'xml':
      return (await import('@codemirror/lang-xml')).xml()
    case 'yaml':
      return (await import('@codemirror/lang-yaml')).yaml()
    case 'plain':
      return []
  }
  throw new Error('Unknown syntax language.')
}
