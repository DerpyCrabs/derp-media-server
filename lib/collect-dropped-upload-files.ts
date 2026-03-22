async function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const entries: FileSystemEntry[] = []
  let batch: FileSystemEntry[]
  do {
    batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject)
    })
    entries.push(...batch)
  } while (batch.length > 0)
  return entries
}

async function readEntry(entry: FileSystemEntry, basePath: string, files: File[]): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry
    const file = await new Promise<File>((resolve, reject) => {
      fileEntry.file(resolve, reject)
    })
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name
    files.push(new File([file], relativePath, { type: file.type, lastModified: file.lastModified }))
  } else if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry
    const reader = dirEntry.createReader()
    const sub = await readAllEntries(reader)
    const dirPath = basePath ? `${basePath}/${entry.name}` : entry.name
    await Promise.all(sub.map((child) => readEntry(child, dirPath, files)))
  }
}

export async function collectDroppedUploadFiles(dataTransfer: DataTransfer): Promise<File[]> {
  const files: File[] = []
  const items = dataTransfer.items

  if (items) {
    const entries: FileSystemEntry[] = []
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.()
      if (entry) entries.push(entry)
    }

    if (entries.length > 0) {
      await Promise.all(entries.map((ent) => readEntry(ent, '', files)))
      return files
    }
  }

  for (let i = 0; i < dataTransfer.files.length; i++) {
    files.push(dataTransfer.files[i])
  }
  return files
}
