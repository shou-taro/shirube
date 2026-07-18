import { expect, test } from '@playwright/test'

import { connect } from './helpers'

test('travels to a related table from the detail panel', async ({ page }) => {
  await connect(page)

  // `books` references `authors`; expand that section and follow the link.
  await page.getByRole('button', { name: /^References/ }).click()
  await page.getByRole('button', { name: /authors/ }).click()

  // The centre is now `authors`; its rows confirm the travel.
  await page.getByRole('button', { name: 'View data' }).click()
  await expect(page.getByText('Ursula K. Le Guin')).toBeVisible({ timeout: 15_000 })
})
