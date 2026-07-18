import { expect, test } from '@playwright/test'

import { DB, SCHEMA } from './config'

test('connects to a database and renders the ER map', async ({ page }) => {
  await page.goto('/')

  // With no saved connections, the screen opens straight into the form.
  await page.getByLabel('Name').fill('e2e')
  await page.getByLabel('Host').fill(DB.host)
  await page.getByLabel('Port').fill(DB.port)
  await page.getByLabel('Database').fill(DB.database)
  await page.getByLabel('User').fill(DB.username)
  await page.getByLabel('Password').fill(DB.password)
  await page.getByLabel('Schemas').fill(SCHEMA)
  await page.getByRole('button', { name: 'Save and connect' }).click()

  // The map (and detail panel) show the seeded tables.
  await expect(page.getByText('books').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('authors').first()).toBeVisible()
})
