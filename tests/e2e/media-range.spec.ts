import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const batchId = process.env.BATCH_ID
const mediaDirName = batchId ? `test-media-${batchId}` : 'test-media'
const mediaUrl = '/api/media/Documents/reader.epub'
let fixture: Buffer

function expectPartialHeaders(response: APIResponse, start: number, end: number) {
  const headers = response.headers()
  expect(headers['accept-ranges']).toBe('bytes')
  expect(headers['content-range']).toBe(`bytes ${start}-${end}/${fixture.length}`)
  expect(headers['content-length']).toBe(String(end - start + 1))
}

async function expectPartialResponse(
  request: APIRequestContext,
  range: string,
  start: number,
  end: number,
) {
  const response = await request.get(mediaUrl, {
    headers: { Range: range, 'Accept-Encoding': 'identity' },
  })
  expect(response.status()).toBe(206)
  expectPartialHeaders(response, start, end)
  expect(await response.body()).toEqual(fixture.subarray(start, end + 1))
}

async function expectUnsatisfiable(request: APIRequestContext, range: string) {
  const response = await request.get(mediaUrl, {
    headers: { Range: range, 'Accept-Encoding': 'identity' },
  })
  expect(response.status()).toBe(416)
  await expect(response.json()).resolves.toEqual({
    code: 'rangeNotSatisfiable',
    message: 'Invalid range',
  })
}

test.beforeAll(() => {
  fixture = fs.readFileSync(path.resolve(mediaDirName, 'Documents', 'reader.epub'))
})

test('owner media preserves full and byte-range responses', async ({ request }) => {
  await test.step('full response', async () => {
    const response = await request.get(mediaUrl, {
      headers: { 'Accept-Encoding': 'identity' },
    })
    const headers = response.headers()
    expect(response.status()).toBe(200)
    expect(headers['accept-ranges']).toBe('bytes')
    expect(headers['content-range']).toBeUndefined()
    expect(headers['content-length']).toBe(String(fixture.length))
    expect(await response.body()).toEqual(fixture)
  })

  await test.step('bounded range', async () => {
    await expectPartialResponse(request, 'bytes=3-12', 3, 12)
  })

  await test.step('open-ended range', async () => {
    await expectPartialResponse(request, 'bytes=16-', 16, fixture.length - 1)
  })

  await test.step('suffix range', async () => {
    await expectPartialResponse(request, 'bytes=-9', fixture.length - 9, fixture.length - 1)
  })

  await test.step('invalid range', async () => {
    await expectUnsatisfiable(request, 'bytes=12-3')
  })

  await test.step('out-of-bounds range', async () => {
    await expectUnsatisfiable(request, `bytes=${fixture.length}-`)
  })
})
