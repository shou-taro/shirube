import { expect, test } from '@playwright/test'

import { connect } from './helpers'

test('reconnects to the last connection after a reload', async ({ page }) => {
  await connect(page)

  await page.reload()

  // The map comes back without going through the connection form again.
  await expect(page.getByText('books').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByLabel('Name')).toBeHidden()
})

test('applies the dark theme from settings', async ({ page }) => {
  await connect(page)

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Dark' }).click()

  await expect(page.locator('html')).toHaveClass(/dark/)
})
