import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

type ResourceSummary = {
  ref: { libraryId: string; resourceId: string }
  locator: { sourceId: string; providerLocator: string }
  legacyLocator?: string
  version?: string
  name: string
  kind: string
  presentation: string
  providerOperations: string[]
  availability: string
}

type FileItem = {
  name: string
  path: string
  resource?: ResourceSummary
}

type FileListing = { files: FileItem[] }
type ShareInfo = {
  authorized: boolean
  isDirectory: boolean
  resource?: ResourceSummary
}

test.describe('Stage 2 Resource read plane', () => {
  test('owner API, SSR, inspect, and Grant return durable semantic Resources', async ({ page }) => {
    const ownerResponse = await page.request.get('/api/files?dir=Documents')
    expect(ownerResponse.ok()).toBe(true)
    const owner = (await ownerResponse.json()) as FileListing
    const note = owner.files.find((file) => file.name === 'notes.md')
    expect(note?.resource).toMatchObject({
      name: 'notes.md',
      kind: 'file',
      presentation: 'text',
      availability: 'present',
    })
    expect(note?.resource?.version).toMatch(/^fs:v1:/)
    expect(note?.resource?.locator.providerLocator).toBe('Documents/notes.md')

    await page.goto('/?dir=Documents')
    const dehydrated = await page.evaluate(() => {
      const state = (
        window as typeof window & {
          __DEHYDRATED_STATE__?: {
            queries?: Array<{ queryKey?: unknown[]; state?: { data?: FileListing } }>
          }
        }
      ).__DEHYDRATED_STATE__
      return state?.queries?.find(
        (query) => JSON.stringify(query.queryKey) === JSON.stringify(['files', 'Documents']),
      )?.state?.data
    })
    expect(dehydrated).toEqual(owner)

    const reference = note!.resource!.ref
    const inspect = await page.request.get(
      `/api/resources/inspect?libraryId=${encodeURIComponent(reference.libraryId)}` +
        `&resourceId=${encodeURIComponent(reference.resourceId)}`,
    )
    expect(inspect.ok()).toBe(true)
    expect((await inspect.json()).summary.ref).toEqual(reference)
    const ownerResolve = await page.request.get(
      '/api/resources/resolve?legacyLocator=Documents%2Fnotes.md&surface=workspace',
    )
    expect(ownerResolve.ok()).toBe(true)
    expect((await ownerResolve.json()).summary.ref).toEqual(reference)

    const sharedOwner = (await (
      await page.request.get('/api/files?dir=SharedContent')
    ).json()) as FileListing
    const ownerPhoto = sharedOwner.files.find((file) => file.name === 'photo.jpg')
    expect(ownerPhoto?.resource).toBeDefined()
    const verified = await page.request.post('/api/share/test-passcode-share-token1/verify', {
      data: { passcode: 'secret123' },
    })
    expect(verified.ok(), await verified.text()).toBe(true)
    const grant = (await (
      await page.request.get('/api/share/test-passcode-share-token1/files?dir=')
    ).json()) as FileListing
    const grantPhoto = grant.files.find((file) => file.name === 'photo.jpg')
    expect(grantPhoto?.resource?.ref).toEqual(ownerPhoto?.resource?.ref)
    expect(grantPhoto?.resource?.providerOperations).toEqual(
      expect.arrayContaining(['read', 'download']),
    )

    const grantReference = grantPhoto!.resource!.ref
    const grantInspect = await page.request.get(
      `/api/share/test-passcode-share-token1/resources/inspect?` +
        `libraryId=${encodeURIComponent(grantReference.libraryId)}` +
        `&resourceId=${encodeURIComponent(grantReference.resourceId)}`,
    )
    expect(grantInspect.ok()).toBe(true)
    expect((await grantInspect.json()).summary.ref).toEqual(grantReference)
    const grantResolve = await page.request.get(
      '/api/share/test-passcode-share-token1/resources/resolve?' +
        'legacyLocator=SharedContent%2Fphoto.jpg',
    )
    expect(grantResolve.ok()).toBe(true)
    expect((await grantResolve.json()).summary.ref).toEqual(grantReference)

    const outsideGrant = await page.request.get(
      `/api/share/test-passcode-share-token1/resources/inspect?` +
        `libraryId=${encodeURIComponent(reference.libraryId)}` +
        `&resourceId=${encodeURIComponent(reference.resourceId)}`,
    )
    expect(outsideGrant.status()).toBe(403)
    expect(await outsideGrant.json()).toEqual({
      code: 'forbidden',
      message: 'Resource is outside Grant scope',
    })
    const outsideGrantResolve = await page.request.get(
      '/api/share/test-passcode-share-token1/resources/resolve?' +
        'legacyLocator=Documents%2Fnotes.md',
    )
    expect(outsideGrantResolve.status()).toBe(403)
    expect(await outsideGrantResolve.json()).toEqual({
      code: 'forbidden',
      message: 'Resource is outside Grant scope',
    })

    const infoResponse = await page.request.get('/api/share/test-passcode-share-token1/info')
    expect(infoResponse.ok()).toBe(true)
    const info = (await infoResponse.json()) as ShareInfo
    await page.goto('/share/test-passcode-share-token1')
    const shareSsr = await page.evaluate((token) => {
      const queries = (
        window as typeof window & {
          __DEHYDRATED_STATE__?: {
            queries?: Array<{ queryKey?: unknown[]; state?: { data?: unknown } }>
          }
        }
      ).__DEHYDRATED_STATE__?.queries
      const data = (key: unknown[]) =>
        queries?.find((query) => JSON.stringify(query.queryKey) === JSON.stringify(key))?.state
          ?.data
      return {
        info: data(['share-info', token]),
        files: data(['share-files', token, '']),
      }
    }, 'test-passcode-share-token1')
    expect(shareSsr.info).toEqual(info)
    expect(shareSsr.files).toEqual(grant)
  })

  test('single-file Grant never expands when shared file becomes a directory', async ({ page }) => {
    const suffix = process.env.BATCH_ID ?? 'local'
    const folderName = `Stage2SingleGrantBoundary-${suffix}`
    const logicalRoot = `${folderName}/shared.txt`
    const mediaDir = path.resolve(process.env.BATCH_ID ? `test-media-${suffix}` : 'test-media')
    const fixtureRoot = path.join(mediaDir, folderName)
    const sharedPath = path.join(fixtureRoot, 'shared.txt')
    fs.mkdirSync(fixtureRoot, { recursive: true })
    fs.writeFileSync(sharedPath, 'shared file')

    let token: string | undefined
    try {
      const created = await page.request.post('/api/shares', {
        data: { path: logicalRoot, isDirectory: false },
      })
      expect(created.ok()).toBe(true)
      const share = (await created.json()).share as { token: string; passcode?: string }
      token = share.token
      if (share.passcode) {
        const verified = await page.request.post(`/api/share/${token}/verify`, {
          data: { passcode: share.passcode },
        })
        expect(verified.ok(), await verified.text()).toBe(true)
      }

      fs.rmSync(sharedPath)
      fs.mkdirSync(sharedPath)
      fs.writeFileSync(path.join(sharedPath, 'secret.txt'), 'must stay private')

      const owner = (await (
        await page.request.get(`/api/files?dir=${encodeURIComponent(logicalRoot)}`)
      ).json()) as FileListing
      const secret = owner.files.find((file) => file.name === 'secret.txt')
      expect(secret?.resource?.ref).toBeDefined()
      const reference = secret!.resource!.ref

      const inspect = await page.request.get(
        `/api/share/${token}/resources/inspect?` +
          `libraryId=${encodeURIComponent(reference.libraryId)}` +
          `&resourceId=${encodeURIComponent(reference.resourceId)}`,
      )
      expect(inspect.status()).toBe(403)
      expect(await inspect.json()).toEqual({
        code: 'forbidden',
        message: 'Resource is outside Grant scope',
      })

      const resolve = await page.request.get(
        `/api/share/${token}/resources/resolve?` +
          `legacyLocator=${encodeURIComponent(`${logicalRoot}/secret.txt`)}`,
      )
      expect(resolve.status()).toBe(403)
      expect(await resolve.json()).toEqual({
        code: 'forbidden',
        message: 'Resource is outside Grant scope',
      })
    } finally {
      if (token) {
        await page.request.post('/api/shares/delete', { data: { token } }).catch(() => {})
      }
      fs.rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })
})
