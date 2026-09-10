import { expect, type Locator, type Page } from '@playwright/test'

export async function dragPlaybackPosition(
  page: Page,
  media: Locator,
  slider: Locator,
  touch = false,
) {
  await expect
    .poll(() => media.evaluate((element: HTMLMediaElement) => element.readyState))
    .toBeGreaterThanOrEqual(2)
  await media.evaluate((element: HTMLMediaElement) => {
    element.pause()
    const events: string[] = []
    element.dataset.seekEvents = '[]'
    for (const name of ['seeking', 'emptied'])
      element.addEventListener(name, () => {
        events.push(name)
        element.dataset.seekEvents = JSON.stringify(events)
      })
  })
  await expect.poll(() => media.evaluate((element: HTMLMediaElement) => element.paused)).toBe(true)
  const box = (await slider.boundingBox())!
  const duration = Number(await slider.getAttribute('max'))
  const cdp = touch ? await page.context().newCDPSession(page) : null
  const point = (ratio: number) => ({ x: box.x + box.width * ratio, y: box.y + box.height / 2 })
  if (cdp)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(0.2)] })
  else {
    await page.mouse.move(point(0.2).x, point(0.2).y)
    await page.mouse.down()
  }
  for (const ratio of [0.3, 0.6, 0.4]) {
    if (cdp)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(ratio)] })
    else await page.mouse.move(point(ratio).x, point(ratio).y, { steps: 6 })
    await page.waitForTimeout(100)
    expect(Math.abs(Number(await slider.inputValue()) - duration * ratio)).toBeLessThan(
      Math.max(0.25, duration * 0.06),
    )
  }
  expect(JSON.parse((await media.getAttribute('data-seek-events'))!)).toEqual([])
  const target = Number(await slider.inputValue())
  if (cdp) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await cdp.detach()
  } else await page.mouse.up()
  await expect
    .poll(() =>
      media.evaluate(
        (element: HTMLMediaElement, target) => Math.abs(element.currentTime - target),
        target,
      ),
    )
    .toBeLessThan(0.25)
  await expect.poll(() => media.evaluate((element: HTMLMediaElement) => element.paused)).toBe(true)
  const events = JSON.parse((await media.getAttribute('data-seek-events'))!) as string[]
  expect(events.filter((event) => event === 'emptied').length).toBeLessThanOrEqual(1)
  return target
}
