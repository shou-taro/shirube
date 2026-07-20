import { expect, type Page, test } from '@playwright/test'

import { DB, SCHEMA } from './config'

/**
 * Managing saved connections through the row action menu.
 *
 * The menu is a Radix dropdown rendered in a portal, which the unit tests deliberately skip
 * — here it runs in a real browser, so edit, duplicate and delete are exercised for real. The
 * test creates its own profiles and removes them, leaving the shared "e2e" connection (used
 * by the other specs) untouched.
 */

/** Open a saved connection's action menu by the row's exact name. */
function rowMenu(page: Page, name: string) {
  return page
    .getByRole('listitem')
    .filter({ has: page.getByText(name, { exact: true }) })
    .getByRole('button', { name: 'More actions' })
}

/** Open the connection form, whether the screen starts on the list or the empty form. */
async function openForm(page: Page): Promise<void> {
  await page.goto('/')
  const newButton = page.getByRole('button', { name: 'New' })
  await expect(newButton.or(page.getByLabel('Name')).first()).toBeVisible({ timeout: 15_000 })
  if (await newButton.isVisible()) {
    await newButton.click()
  }
}

/** Fill the form for a new profile and save, which connects into the explorer. */
async function createProfile(page: Page, name: string): Promise<void> {
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Host').fill(DB.host)
  await page.getByLabel('Port').fill(DB.port)
  await page.getByLabel('Database').fill(DB.database)
  await page.getByLabel('User').fill(DB.username)
  await page.getByLabel('Password').fill(DB.password)
  await page.getByLabel('Schemas').fill(SCHEMA)
  await page.getByRole('button', { name: 'Save and connect' }).click()
  await expect(page.getByText('books').first()).toBeVisible({ timeout: 15_000 })
  await page.getByTitle('Switch connection').click()
}

test('edits, duplicates and deletes a connection from the row menu', async ({ page }) => {
  await openForm(page)
  await createProfile(page, 'e2e-menu')
  await expect(page.getByText('e2e-menu', { exact: true })).toBeVisible({ timeout: 15_000 })

  // Edit opens the form on that profile — the name field is prefilled.
  await rowMenu(page, 'e2e-menu').click()
  await page.getByRole('menuitem', { name: 'Edit' }).click()
  await expect(page.getByLabel('Name')).toHaveValue('e2e-menu')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('button', { name: 'New' })).toBeVisible()

  // Duplicate opens the form prefilled with a "copy" name; a new profile needs a password.
  await rowMenu(page, 'e2e-menu').click()
  await page.getByRole('menuitem', { name: 'Duplicate' }).click()
  await expect(page.getByLabel('Name')).toHaveValue('e2e-menu copy')
  await page.getByLabel('Password').fill(DB.password)
  await page.getByRole('button', { name: 'Save and connect' }).click()
  await expect(page.getByText('books').first()).toBeVisible({ timeout: 15_000 })
  await page.getByTitle('Switch connection').click()
  await expect(page.getByText('e2e-menu copy', { exact: true })).toBeVisible({ timeout: 15_000 })

  // Delete the copy; it goes, and the original remains.
  await rowMenu(page, 'e2e-menu copy').click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(page.getByText('e2e-menu copy', { exact: true })).toBeHidden()
  await expect(page.getByText('e2e-menu', { exact: true })).toBeVisible()

  // Clean up the profile this test created.
  await rowMenu(page, 'e2e-menu').click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(page.getByText('e2e-menu', { exact: true })).toBeHidden()
})
