import { test as setup, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const authDir = path.join(__dirname, '.auth')
const storageStatePath = path.join(authDir, 'session.json')

setup('authenticate', async ({ page }) => {
  fs.mkdirSync(authDir, { recursive: true })

  await page.goto('/login')
  await page.locator('input[type="password"]').fill('test-password')
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page).toHaveURL(/\/(\?|$)/)

  await page.context().storageState({ path: storageStatePath })
})
