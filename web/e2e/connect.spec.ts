import { expect, test } from '@playwright/test'

import { connect } from './helpers'

test('connects to a database and renders the ER map', async ({ page }) => {
  await connect(page)

  // Both seeded tables appear on the map / detail.
  await expect(page.getByText('authors').first()).toBeVisible()
})
