import { createKeyedAsyncTaskQueue } from './async-task-queue'

export type TextDocumentTarget =
  | { kind: 'admin'; viewingPath: string }
  | { kind: 'share'; token: string; sharePath: string; viewingPath: string }

type ShareTargetContext = { token: string; sharePath: string }

const saveQueue = createKeyedAsyncTaskQueue<string>()

export function createTextDocumentTarget(
  viewingPath: string,
  share: ShareTargetContext | null | undefined,
): TextDocumentTarget {
  return share
    ? { kind: 'share', token: share.token, sharePath: share.sharePath, viewingPath }
    : { kind: 'admin', viewingPath }
}

export function textDocumentTargetKey(target: TextDocumentTarget): string {
  return target.kind === 'share'
    ? JSON.stringify(['share', target.token, target.sharePath, target.viewingPath])
    : JSON.stringify(['admin', target.viewingPath])
}

export function textDocumentDraftScope(target: TextDocumentTarget): string {
  return target.kind === 'share'
    ? `share:${JSON.stringify([target.token, target.sharePath])}`
    : 'admin'
}

export function enqueueTextDocumentSave<T>(
  target: TextDocumentTarget,
  task: () => Promise<T>,
): Promise<T> {
  return saveQueue.run(textDocumentTargetKey(target), task)
}
