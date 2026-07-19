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
  // Exact match: the search box's label ("Search tables and columns…") otherwise also
  // matches the substring "Column".
  await page.getByLabel('Column', { exact: true }).selectOption('title')
  await page.getByPlaceholder('Value').fill('Wizard')

  await expect(page.getByText('A Wizard of Earthsea')).toBeVisible()
  await expect(page.getByText('Exhalation')).toBeHidden()
})

test('sorts rows by a column header', async ({ page }) => {
  await connect(page)

  await page.getByRole('button', { name: 'View data' }).click()
  await expect(page.getByText('A Wizard of Earthsea')).toBeVisible({ timeout: 15_000 })

  // The row positions of the three known titles.
  const order = async () => {
    const rows = await page.getByRole('row').allInnerTexts()
    return {
      wizard: rows.findIndex((row) => row.includes('A Wizard of Earthsea')),
      exhalation: rows.findIndex((row) => row.includes('Exhalation')),
      left: rows.findIndex((row) => row.includes('The Left Hand of Darkness')),
    }
  }

  // Ascending by title: A Wizard < Exhalation < The Left Hand.
  await page.getByRole('columnheader', { name: 'title' }).click()
  await expect
    .poll(async () => {
      const o = await order()
      return o.wizard >= 0 && o.wizard < o.exhalation && o.exhalation < o.left
    })
    .toBe(true)

  // Clicking again flips to descending.
  await page.getByRole('columnheader', { name: 'title' }).click()
  await expect
    .poll(async () => {
      const o = await order()
      return o.left >= 0 && o.left < o.exhalation && o.exhalation < o.wizard
    })
    .toBe(true)
})
