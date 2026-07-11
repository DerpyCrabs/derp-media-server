const EXCLUDED_FOLDERS = new Set([
  'node_modules',
  '$RECYCLE.BIN',
  'System Volume Information',
  '.git',
  '.svn',
  '.hg',
  '__pycache__',
  '.DS_Store',
])

const EXCLUDED_FILES = new Set([
  'pagefile.sys',
  'swapfile.sys',
  'hiberfil.sys',
  'DumpStack.log',
  'DumpStack.log.tmp',
  'desktop.ini',
  'Thumbs.db',
  '.DS_Store',
])

export function shouldExcludeFolder(folderName: string): boolean {
  return folderName.startsWith('.') || EXCLUDED_FOLDERS.has(folderName)
}

export function shouldExcludeFile(fileName: string): boolean {
  return EXCLUDED_FILES.has(fileName)
}
