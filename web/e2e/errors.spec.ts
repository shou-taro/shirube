import { expect, test } from '@playwright/test'

/** Reach the connection form, opening it if a saved connection is already listed. */
async function openForm(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/')
  const nameField = page.getByLabel('Name')
  const newButton = page.getByRole('button', { name: 'New' })
  await expect(nameField.or(newButton).first()).toBeVisible({ timeout: 15_000 })
  if (await newButton.isVisible()) {
    await newButton.click()
  }
}

/** Fill the form with a connection that refuses immediately (port 1). */
async function fillUnreachable(
  page: import('@playwright/test').Page,
  name: string,
): Promise<void> {
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Host').fill('127.0.0.1')
  await page.getByLabel('Port').fill('1') // refused immediately
  await page.getByLabel('Database').fill('x')
  await page.getByLabel('User').fill('x')
  await page.getByLabel('Password').fill('x')
}

test('shows a translated error for an unreachable database', async ({ page }) => {
  await openForm(page)
  await fillUnreachable(page, 'broken')
  await page.getByRole('button', { name: 'Test' }).click()

  await expect(page.getByText(/Could not reach/)).toBeVisible({ timeout: 15_000 })
})

test('save and connect stays on the form when the connection fails', async ({ page }) => {
  // The reported bug: a wrong host used to save and then drop the user onto the ER
  // screen showing an error. It must surface on the form and never enter the explorer.
  await openForm(page)
  await fillUnreachable(page, 'broken-connect')
  await page.getByRole('button', { name: 'Save and connect' }).click()

  await expect(page.getByText(/Could not reach/)).toBeVisible({ timeout: 15_000 })
  // Still on the form — the explorer has no such button.
  await expect(page.getByRole('button', { name: 'Save and connect' })).toBeVisible()
})
