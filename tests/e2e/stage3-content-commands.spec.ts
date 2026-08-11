import { expect, test, type Page } from '@playwright/test'

type Receipt = {
  schemaVersion: number
  commandId: string
  idempotencyKey: string
  affectedRefs: Array<{ libraryId: string; resourceId: string }>
  resultingVersions: Array<{
    ref: { libraryId: string; resourceId: string }
    version?: string
  }>
  event: {
    commandId: string
    scope: { owner: boolean; grantIds?: string[] }
  }
}

const minimalPngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='

type CreatedShare = { token: string; passcode?: string }

async function authenticateShare(page: Page, share: CreatedShare) {
  if (!share.passcode) return
  const verified = await page.request.post(`/api/share/${share.token}/verify`, {
    data: { passcode: share.passcode },
  })
  expect(verified.ok(), await verified.text()).toBe(true)
}

function expectReceipt(receipt: Receipt, key: string) {
  expect(receipt.schemaVersion).toBe(1)
  expect(receipt.commandId).toMatch(/^command-/)
  expect(receipt.idempotencyKey).toBe(key)
  expect(receipt.affectedRefs.length).toBeGreaterThan(0)
  expect(receipt.resultingVersions.length).toBeGreaterThan(0)
  expect(receipt.event.commandId).toBe(receipt.commandId)
  expect(receipt.event.scope.owner).toBe(true)
}

test('owner and Grant adapters share command receipts, idempotency, and policy', async ({
  page,
}, testInfo) => {
  const unique = `${testInfo.workerIndex}-${Date.now()}`
  const root = `SharedContent/stage3-${unique}`
  const tokens: string[] = []
  try {
    const ownerKey = `stage3-owner-${unique}`
    const ownerBody = {
      type: 'file',
      path: `${root}/owner.txt`,
      content: 'owner command',
    }
    const owner = await page.request.post('/api/files/create', {
      headers: { 'Idempotency-Key': ownerKey },
      data: ownerBody,
    })
    expect(owner.ok(), await owner.text()).toBe(true)
    const ownerJson = (await owner.json()) as { receipt: Receipt }
    expectReceipt(ownerJson.receipt, ownerKey)

    const ownerRepeat = await page.request.post('/api/files/create', {
      headers: { 'Idempotency-Key': ownerKey },
      data: ownerBody,
    })
    expect(ownerRepeat.ok(), await ownerRepeat.text()).toBe(true)
    expect(((await ownerRepeat.json()) as { receipt: Receipt }).receipt.commandId).toBe(
      ownerJson.receipt.commandId,
    )

    const ownerConflict = await page.request.post('/api/files/create', {
      headers: { 'Idempotency-Key': ownerKey },
      data: { ...ownerBody, content: 'different digest' },
    })
    expect(ownerConflict.status()).toBe(409)
    await expect(ownerConflict.json()).resolves.toMatchObject({
      code: 'idempotencyConflict',
      retryable: false,
    })

    const editableResponse = await page.request.post('/api/shares', {
      data: {
        path: root,
        isDirectory: true,
        editable: true,
        restrictions: {
          allowUpload: true,
          allowEdit: true,
          allowDelete: true,
          maxUploadBytes: 1024,
        },
      },
    })
    expect(editableResponse.ok()).toBe(true)
    const editable = (await editableResponse.json()) as { share: CreatedShare }
    tokens.push(editable.share.token)
    await authenticateShare(page, editable.share)

    const grantKey = `stage3-grant-${unique}`
    const grantBody = {
      type: 'file',
      path: 'nested/a/grant.txt',
      content: 'Grant command',
    }
    const grant = await page.request.post(`/api/share/${editable.share.token}/create`, {
      headers: { 'Idempotency-Key': grantKey },
      data: grantBody,
    })
    expect(grant.ok(), await grant.text()).toBe(true)
    const grantJson = (await grant.json()) as { receipt: Receipt; receipts: Receipt[] }
    expectReceipt(grantJson.receipt, grantKey)
    expect(grantJson.receipts.length).toBeGreaterThanOrEqual(3)
    expect(grantJson.receipt.event.scope.grantIds?.length).toBeGreaterThan(0)

    const grantRepeat = await page.request.post(`/api/share/${editable.share.token}/create`, {
      headers: { 'Idempotency-Key': grantKey },
      data: grantBody,
    })
    expect(grantRepeat.ok(), await grantRepeat.text()).toBe(true)
    expect(((await grantRepeat.json()) as { receipt: Receipt }).receipt.commandId).toBe(
      grantJson.receipt.commandId,
    )
    const grantState = (await (await page.request.get('/api/shares')).json()) as {
      shares: Array<{ token: string; usedBytes?: number }>
    }
    expect(
      grantState.shares.find((candidate) => candidate.token === editable.share.token)?.usedBytes,
    ).toBe(Buffer.byteLength('Grant command'))

    const readOnlyResponse = await page.request.post('/api/shares', {
      data: { path: root, isDirectory: true },
    })
    const readOnly = (await readOnlyResponse.json()) as { share: CreatedShare }
    tokens.push(readOnly.share.token)
    await authenticateShare(page, readOnly.share)
    const denied = await page.request.post(`/api/share/${readOnly.share.token}/create`, {
      data: { type: 'file', path: 'denied.txt', content: 'denied' },
    })
    expect(denied.status()).toBe(403)

    const quotaResponse = await page.request.post('/api/shares', {
      data: {
        path: root,
        isDirectory: true,
        editable: true,
        restrictions: {
          allowUpload: true,
          allowEdit: false,
          allowDelete: false,
          maxUploadBytes: 2,
        },
      },
    })
    const quota = (await quotaResponse.json()) as { share: CreatedShare }
    tokens.push(quota.share.token)
    await authenticateShare(page, quota.share)
    const overQuota = await page.request.post(`/api/share/${quota.share.token}/create`, {
      data: { type: 'file', path: 'too-large.txt', content: 'four' },
    })
    expect(overQuota.status()).toBe(413)
    await expect(overQuota.json()).resolves.toMatchObject({
      error: expect.stringContaining('quota'),
    })

    const removeNested = await page.request.post(`/api/share/${editable.share.token}/delete`, {
      data: { path: 'nested' },
    })
    expect(removeNested.ok(), await removeNested.text()).toBe(true)
  } finally {
    for (const token of tokens) {
      await page.request.post('/api/shares/delete', { data: { token } }).catch(() => {})
    }
    await page.request.post('/api/files/delete', { data: { path: root } }).catch(() => {})
  }
})

test('owner move keeps ResourceRef and relocates Grant root', async ({ page }, testInfo) => {
  const unique = `${testInfo.workerIndex}-${Date.now()}`
  const oldRoot = `SharedContent/stage3-move-${unique}`
  const newRoot = `SharedContent/stage3-moved-${unique}`
  let token = ''
  try {
    const created = await page.request.post('/api/files/create', {
      data: { type: 'file', path: `${oldRoot}/note.md`, content: '# stable' },
    })
    expect(created.ok(), await created.text()).toBe(true)
    const beforeResponse = await page.request.get('/api/resources/resolve', {
      params: { legacyLocator: oldRoot, surface: 'library' },
    })
    const before = (await beforeResponse.json()) as {
      summary: { ref: { libraryId: string; resourceId: string } }
    }
    const shareResponse = await page.request.post('/api/shares', {
      data: {
        path: oldRoot,
        isDirectory: true,
        editable: true,
        restrictions: { allowUpload: true, allowEdit: true, allowDelete: true },
      },
    })
    const share = (await shareResponse.json()) as { share: CreatedShare }
    token = share.share.token
    await authenticateShare(page, share.share)

    const keepName = `keep-${unique}.png`
    const cancelName = `cancel-${unique}.png`
    const keepKey = `stage3-image-keep-${unique}`
    const cancelKey = `stage3-image-cancel-${unique}`
    const uploadImage = async (fileName: string, key: string) => {
      const response = await page.request.post(`/api/share/${token}/upload-image`, {
        headers: { 'Idempotency-Key': key },
        data: { base64Content: minimalPngBase64, mimeType: 'image/png', fileName },
      })
      expect(response.ok(), await response.text()).toBe(true)
      return (await response.json()) as { rollbackId: string }
    }
    const keepUpload = await uploadImage(keepName, keepKey)
    const cancelUpload = await uploadImage(cancelName, cancelKey)

    const moved = await page.request.post('/api/files/rename', {
      headers: { 'Idempotency-Key': `stage3-move-${unique}` },
      data: { oldPath: oldRoot, newPath: newRoot },
    })
    expect(moved.ok(), await moved.text()).toBe(true)
    const movedJson = (await moved.json()) as { receipt: Receipt }
    expect(movedJson.receipt.affectedRefs).toContainEqual(before.summary.ref)

    const afterResponse = await page.request.get('/api/resources/resolve', {
      params: { legacyLocator: newRoot, surface: 'library' },
    })
    const after = (await afterResponse.json()) as {
      summary: { ref: { libraryId: string; resourceId: string } }
    }
    expect(after.summary.ref).toEqual(before.summary.ref)

    const sharesResponse = await page.request.get('/api/shares')
    const shares = (await sharesResponse.json()) as {
      shares: Array<{ token: string; path: string }>
    }
    expect(shares.shares.find((candidate) => candidate.token === token)?.path).toBe(newRoot)

    const finalized = await page.request.post(`/api/share/${token}/finalize-image-upload`, {
      data: { rollbackId: keepUpload.rollbackId },
    })
    expect(finalized.ok(), await finalized.text()).toBe(true)
    const replayedKeep = await uploadImage(keepName, keepKey)
    expect(replayedKeep.rollbackId).toBe(keepUpload.rollbackId)
    const replayedCancel = await page.request.post(`/api/share/${token}/cancel-image-upload`, {
      data: { rollbackId: replayedKeep.rollbackId },
    })
    expect(replayedCancel.status()).toBe(403)

    const cancelled = await page.request.post(`/api/share/${token}/cancel-image-upload`, {
      data: { rollbackId: cancelUpload.rollbackId },
    })
    expect(cancelled.ok(), await cancelled.text()).toBe(true)

    const media = (name: string) =>
      `/api/share/${token}/media/${['images', name].map(encodeURIComponent).join('/')}`
    expect((await page.request.get(media(keepName))).ok()).toBe(true)
    expect((await page.request.get(media(cancelName))).status()).toBe(404)
  } finally {
    if (token) {
      await page.request.post('/api/shares/delete', { data: { token } }).catch(() => {})
    }
    await page.request.post('/api/files/delete', { data: { path: newRoot } }).catch(() => {})
    await page.request.post('/api/files/delete', { data: { path: oldRoot } }).catch(() => {})
  }
})

test('replayed Markdown save settles pending image rollback capability', async ({
  page,
}, testInfo) => {
  const unique = `${testInfo.workerIndex}-${Date.now()}`
  const markdownPath = `SharedContent/stage3-markdown-${unique}.md`
  const imageName = `stage3-replay-${unique}.png`
  const imagePath = `SharedContent/images/${imageName}`
  let token = ''
  try {
    const created = await page.request.post('/api/files/create', {
      data: { type: 'file', path: markdownPath, content: '# Pending image' },
    })
    expect(created.ok(), await created.text()).toBe(true)

    const shareResponse = await page.request.post('/api/shares', {
      data: { path: markdownPath, isDirectory: false },
    })
    const share = (await shareResponse.json()) as { share: CreatedShare }
    token = share.share.token
    await authenticateShare(page, share.share)
    const editable = await page.request.put('/api/shares', {
      data: {
        token,
        editable: true,
        restrictions: { allowUpload: true, allowEdit: true, allowDelete: true },
      },
    })
    expect(editable.ok(), await editable.text()).toBe(true)

    const editKey = `stage3-markdown-edit-${unique}`
    const editBody = { path: '.', content: `![[images/${imageName}]]` }
    const firstEdit = await page.request.post(`/api/share/${token}/edit`, {
      headers: { 'Idempotency-Key': editKey },
      data: editBody,
    })
    expect(firstEdit.ok(), await firstEdit.text()).toBe(true)
    const firstReceipt = ((await firstEdit.json()) as { receipt: Receipt }).receipt

    const upload = await page.request.post(`/api/share/${token}/upload-image`, {
      data: {
        base64Content: minimalPngBase64,
        mimeType: 'image/png',
        fileName: imageName,
      },
    })
    expect(upload.ok(), await upload.text()).toBe(true)
    const uploaded = (await upload.json()) as { rollbackId: string; path: string }
    expect(uploaded.path).toBe(imagePath)

    const replay = await page.request.post(`/api/share/${token}/edit`, {
      headers: { 'Idempotency-Key': editKey },
      data: editBody,
    })
    expect(replay.ok(), await replay.text()).toBe(true)
    expect(((await replay.json()) as { receipt: Receipt }).receipt.commandId).toBe(
      firstReceipt.commandId,
    )

    const cancel = await page.request.post(`/api/share/${token}/cancel-image-upload`, {
      data: { rollbackId: uploaded.rollbackId },
    })
    expect(cancel.status()).toBe(403)

    const mediaPath = imagePath.split('/').map(encodeURIComponent).join('/')
    const image = await page.request.get(`/api/share/${token}/media/${mediaPath}`)
    expect(image.ok(), await image.text()).toBe(true)
  } finally {
    if (token) {
      await page.request.post('/api/shares/delete', { data: { token } }).catch(() => {})
    }
    await page.request.post('/api/files/delete', { data: { path: imagePath } }).catch(() => {})
    await page.request.post('/api/files/delete', { data: { path: markdownPath } }).catch(() => {})
  }
})
