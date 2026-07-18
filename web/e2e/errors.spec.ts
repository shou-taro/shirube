import { expect, test } from '@playwright/test'

test('shows a translated error for an unreachable database', async ({ page }) => {
  await page.goto('/')

  // Reach the form (open it if a saved connection is already listed).
  const nameField = page.getByLabel('Name')
  const newButton = page.getByRole('button', { name: 'New' })
  await expect(nameField.or(newButton).first()).toBeVisible({ timeout: 15_000 })
  if (await newButton.isVisible()) {
    await newButton.click()
  }

  await nameField.fill('broken')
  await page.getByLabel('Host').fill('127.0.0.1')
  await page.getByLabel('Port').fill('1') // refused immediately
  await page.getByLabel('Database').fill('x')
  await page.getByLabel('User').fill('x')
  await page.getByLabel('Password').fill('x')
  await page.getByRole('button', { name: 'Test' }).click()

  await expect(page.getByText(/Could not reach/)).toBeVisible({ timeout: 15_000 })
})
