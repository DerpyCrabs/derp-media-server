import { createKeyedAsyncTaskQueue } from '@/lib/async-task-queue'

export type TextDocumentTarget = { kind: 'admin'; viewingPath: string }

const saveQueue = createKeyedAsyncTaskQueue<string>()

export function createTextDocumentTarget(viewingPath: string): TextDocumentTarget {
  return { kind: 'admin', viewingPath }
}

export function textDocumentTargetKey(target: TextDocumentTarget): string {
  return JSON.stringify(['admin', target.viewingPath])
}

export function enqueueTextDocumentSave<T>(
  target: TextDocumentTarget,
  task: () => Promise<T>,
): Promise<T> {
  return saveQueue.run(textDocumentTargetKey(target), task)
}
