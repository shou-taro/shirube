import { expect, test } from '@playwright/test'

import { connect } from './helpers'

test('searches for a table and travels to it', async ({ page }) => {
  await connect(page)

  await page.getByPlaceholder('Search tables and columns…').fill('authors')
  await page.getByRole('button', { name: /authors/ }).click()

  // The centre is now `authors`; its rows confirm the map recentred.
  await page.getByRole('button', { name: 'View data' }).click()
  await expect(page.getByText('Ursula K. Le Guin')).toBeVisible({ timeout: 15_000 })
})

test('focuses the search with the keyboard shortcut', async ({ page }) => {
  await connect(page)

  // ⌘K on macOS, Ctrl+K elsewhere — matched to the host the browser runs on.
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.keyboard.press(`${modifier}+k`)

  await expect(page.getByPlaceholder('Search tables and columns…')).toBeFocused()
})
