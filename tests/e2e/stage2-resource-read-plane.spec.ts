import { expect, test } from '@playwright/test'

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

    const sharedOwner = (await (
      await page.request.get('/api/files?dir=SharedContent')
    ).json()) as FileListing
    const ownerPhoto = sharedOwner.files.find((file) => file.name === 'photo.jpg')
    expect(ownerPhoto?.resource).toBeDefined()
    const verified = await page.request.post('/api/share/test-passcode-share-token1/verify', {
      data: { passcode: 'secret123' },
    })
    expect(verified.ok()).toBe(true)
    const grant = (await (
      await page.request.get('/api/share/test-passcode-share-token1/files?dir=')
    ).json()) as FileListing
    const grantPhoto = grant.files.find((file) => file.name === 'photo.jpg')
    expect(grantPhoto?.resource?.ref).toEqual(ownerPhoto?.resource?.ref)
    expect(grantPhoto?.resource?.providerOperations).toEqual(
      expect.arrayContaining(['read', 'download']),
    )
  })
})
