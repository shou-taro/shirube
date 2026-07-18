import { expect, test } from '@playwright/test'

import { connect } from './helpers'

test('previews rows and narrows them with a filter', async ({ page }) => {
  await connect(page)

  // The centre table is `books` (the most-connected). Open its rows.
  await page.getByRole('button', { name: 'View data' }).click()
  await expect(page.getByText('A Wizard of Earthsea')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Exhalation')).toBeVisible()

  // Filter title contains "Wizard": only the matching row remains.
  await page.getByRole('button', { name: 'Add filter' }).click()
  await page.getByLabel('Column').selectOption('title')
  await page.getByPlaceholder('Value').fill('Wizard')

  await expect(page.getByText('A Wizard of Earthsea')).toBeVisible()
  await expect(page.getByText('Exhalation')).toBeHidden()
})
