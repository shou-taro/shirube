import { expect, test } from '@playwright/test'

import { connect } from './helpers'

/**
 * The resizable side panes and the navigator toggle.
 *
 * Dragging an edge and having the width survive a reload is a genuinely integrated behaviour
 * — pointer capture, the settings store, and rehydration on load — so it is checked in a real
 * browser rather than a unit test.
 */

test('resizes the navigator pane and remembers the width across a reload', async ({ page }) => {
  await connect(page)

  const pane = page.getByRole('complementary')
  const startWidth = (await pane.boundingBox())?.width ?? 0
  expect(startWidth).toBeGreaterThan(0)

  // Drag the navigator's left edge outward to widen it.
  const handle = page.getByRole('separator', { name: 'Resize the navigator' })
  const box = await handle.boundingBox()
  if (box === null) {
    throw new Error('resize handle not found')
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x - 120, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()

  const widened = (await pane.boundingBox())?.width ?? 0
  expect(widened).toBeGreaterThan(startWidth + 60)

  // The width is stored, so a reload brings it back rather than resetting to the default.
  await page.reload()
  await expect(page.getByText('books').first()).toBeVisible({ timeout: 15_000 })
  const afterReload = (await page.getByRole('complementary').boundingBox())?.width ?? 0
  expect(Math.abs(afterReload - widened)).toBeLessThan(4)
})

test('collapses and reopens the navigator pane from the top bar', async ({ page }) => {
  await connect(page)

  // The pane slides shut by collapsing its container's width, so measure that rather than
  // visibility (the aside keeps its own width, clipped by the container).
  const container = page.getByRole('complementary').locator('xpath=..')
  const width = () => container.evaluate((el) => el.getBoundingClientRect().width)
  expect(await width()).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Collapse' }).click()
  await expect.poll(width).toBe(0)

  await page.getByRole('button', { name: 'Expand' }).click()
  await expect.poll(width).toBeGreaterThan(0)
})
