import { expect, type Page } from '@playwright/test'

export async function waitForDocumentDraft(page: Page, path: string, content?: string) {
  await expect
    .poll(() =>
      page.evaluate(
        ({ path, content }) =>
          new Promise<boolean>((resolve, reject) => {
            const open = indexedDB.open('derp-editor-drafts')
            open.onerror = () => reject(open.error)
            open.onsuccess = () => {
              const database = open.result
              if (!database.objectStoreNames.contains('text')) {
                database.close()
                resolve(false)
                return
              }
              const read = database.transaction('text').objectStore('text').getAll()
              read.onsuccess = () => {
                resolve(
                  read.result.some(
                    (draft) =>
                      draft.path === path &&
                      (content === undefined || draft.content.includes(content)),
                  ),
                )
                database.close()
              }
              read.onerror = () => {
                reject(read.error)
                database.close()
              }
            }
          }),
        { path, content },
      ),
    )
    .toBe(true)
}
