export function fileIconKind(path: string, executable = false) {
  const name = path.replace(/\\/g, '/').split('/').at(-1)!.toLowerCase()
  const ext = name.split('.').at(-1)
  if (/\.(zip|tar|gz|xz|bz2|7z|rar|tgz|txz|zst)$/.test(name) && !name.endsWith('.fb2.zip'))
    return 'archive'
  if (['sh', 'bash', 'zsh', 'fish', 'py', 'ps1', 'bat'].includes(ext!)) return 'script'
  if (executable || ['appimage', 'exe', 'bin', 'desktop'].includes(ext!)) return 'program'
  if (['csv', 'tsv', 'xlsx', 'xls', 'ods'].includes(ext!)) return 'spreadsheet'
  if (['ppt', 'pptx', 'odp'].includes(ext!)) return 'presentation'
  if (['db', 'sqlite', 'sqlite3', 'sql'].includes(ext!)) return 'database'
  if (['ttf', 'otf', 'woff', 'woff2'].includes(ext!)) return 'font'
  if (['deb', 'rpm', 'apk'].includes(ext!)) return 'package'
  if (
    ['json', 'jsonc', 'jsonl', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'env', 'xml'].includes(
      ext!,
    ) ||
    name.startsWith('.env.')
  )
    return 'config'
  if (
    [
      'js',
      'jsx',
      'ts',
      'tsx',
      'html',
      'css',
      'scss',
      'rs',
      'go',
      'c',
      'h',
      'cpp',
      'hpp',
      'java',
      'kt',
      'rb',
      'php',
      'swift',
      'lua',
      'nix',
      'diff',
      'patch',
    ].includes(ext!) ||
    ['makefile', 'dockerfile'].includes(name)
  )
    return 'code'
  return undefined
}
