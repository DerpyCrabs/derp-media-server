import { test, expect } from '@playwright/test'

const PASSCODE_TOKEN = 'test-passcode-share-token1'

test.describe('Login & Auth (Solid UI)', () => {
  test('unauthenticated visit to / redirects to /login', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
  })

  test('login page shows password input and sign-in button', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
    await expect(page.getByText('Media Server')).toBeVisible()
  })

  test('wrong password shows error message', async ({ page }) => {
    await page.goto('/login')
    await page.locator('input[type="password"]').fill('wrong-password')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.locator('.text-destructive')).toBeVisible()
  })

  test('correct password redirects to /', async ({ page }) => {
    await page.goto('/login')
    await page.locator('input[type="password"]').fill('test-password')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/(\?|$)/)
  })

  test('share pages remain accessible without login', async ({ page }) => {
    await page.goto(`/share/${PASSCODE_TOKEN}`)
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.getByText('Protected Share')).toBeVisible()
  })
})
