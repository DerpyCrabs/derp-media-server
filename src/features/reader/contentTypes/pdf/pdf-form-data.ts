export type PdfFieldValue = string | number | boolean | string[]
export type PdfFormValues = Record<string, { name: string; value: PdfFieldValue }>
export function isPdfFieldValue(value: unknown): value is PdfFieldValue {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  )
}
export function parsePdfFormValues(content: string): PdfFormValues | null {
  try {
    const parsed: unknown = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const result: PdfFormValues = Object.create(null)
    for (const [id, field] of Object.entries(parsed)) {
      if (
        !field ||
        typeof field !== 'object' ||
        !('name' in field) ||
        typeof field.name !== 'string' ||
        !('value' in field) ||
        !isPdfFieldValue(field.value)
      )
        return null
      result[id] = { name: field.name, value: field.value }
    }
    return result
  } catch {
    return null
  }
}
