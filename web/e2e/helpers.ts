import { expect, type Page } from '@playwright/test'

import { DB, SCHEMA } from './config'

/**
 * Reach the explorer, connected to the seeded database.
 *
 * The first test of a run fills the form; later tests find the connection already saved
 * (the backend state persists across the run) and click it instead. Either way, this
 * returns once the map has rendered a seeded table.
 */
export async function connect(page: Page): Promise<void> {
  await page.goto('/')

  const nameField = page.getByLabel('Name')
  const savedTile = page.getByRole('button', { name: /^e2e/ })
  await expect(nameField.or(savedTile).first()).toBeVisible({ timeout: 15_000 })

  if (await savedTile.isVisible()) {
    await savedTile.click()
  } else {
    await nameField.fill('e2e')
    await page.getByLabel('Host').fill(DB.host)
    await page.getByLabel('Port').fill(DB.port)
    await page.getByLabel('Database').fill(DB.database)
    await page.getByLabel('User').fill(DB.username)
    await page.getByLabel('Password').fill(DB.password)
    await page.getByLabel('Schemas').fill(SCHEMA)
    await page.getByRole('button', { name: 'Save and connect' }).click()
  }

  await expect(page.getByText('books').first()).toBeVisible({ timeout: 15_000 })
}
