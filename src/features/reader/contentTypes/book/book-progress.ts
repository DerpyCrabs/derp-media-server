import type { BookChapter } from './book-types'

export function bookProgress(
  chapters: Pick<BookChapter, 'id' | 'textLength'>[],
  chapterId: string,
  chapterProgress: number,
): number | undefined {
  const index = chapters.findIndex((chapter) => chapter.id === chapterId)
  if (index < 0) return undefined
  const lengths = chapters.map((chapter) => Math.max(1, chapter.textLength))
  const total = lengths.reduce((sum, length) => sum + length, 0)
  const before = lengths.slice(0, index).reduce((sum, length) => sum + length, 0)
  return (before + lengths[index]! * Math.max(0, Math.min(1, chapterProgress))) / total
}
