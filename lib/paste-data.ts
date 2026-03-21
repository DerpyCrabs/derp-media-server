export interface PasteData {
  type: 'text' | 'image' | 'file'
  content: string
  suggestedName: string
  fileType?: string
  showPreview?: boolean
  fileSize?: number
  isTextContent?: boolean
}
