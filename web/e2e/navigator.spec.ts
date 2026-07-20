import { expect, test } from '@playwright/test'

import { connect } from './helpers'

/**
 * The AI navigator, end to end, without a real model.
 *
 * No provider is reachable in CI, so the provider is pointed at a closed local port. That is
 * enough to exercise the whole stack — the chat route, the tool-calling loop, the provider
 * adapter, the SSE stream and the pane — right up to where a real model would answer: the
 * connection is refused, and the navigator surfaces that as an error in the conversation.
 *
 * A loopback endpoint counts as local, so nothing leaves the machine and the one-time consent
 * (covered in the unit tests) does not gate the send.
 */

// A port nothing listens on, so the adapter's request is refused at once.
const UNREACHABLE = 'http://127.0.0.1:59999/v1'

test('configures a provider, then reports that it could not be reached', async ({ page }) => {
  await connect(page)

  const pane = page.getByRole('complementary')

  // The pane starts with no provider and offers to configure one.
  await expect(pane.getByText('No AI provider configured')).toBeVisible()
  await pane.getByRole('button', { name: 'Configure' }).click()

  // The settings dialog opens straight on the AI navigator group.
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Provider')).toBeVisible()

  // Configure a local OpenAI-compatible endpoint (no key) that nothing is listening on.
  await dialog.getByLabel('Provider').selectOption({ label: 'Ollama (local)' })
  await dialog.getByLabel('Base URL').fill(UNREACHABLE)
  await dialog.getByLabel('Model').fill('test-model')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog.getByText('Saved')).toBeVisible()

  // Close the dialog; the pane now shows the configured provider and model.
  await page.keyboard.press('Escape')
  await expect(pane.getByText('test-model')).toBeVisible()

  // Ask a question. The composer is enabled now that a provider is set.
  const composer = pane.getByPlaceholder('Ask the navigator…')
  await composer.fill('Which table holds books?')
  await pane.getByRole('button', { name: 'Send' }).click()

  // The question shows immediately, and the unreachable provider surfaces as an error —
  // the whole path ran, only the model was absent. (The SDK retries, so allow time.)
  await expect(pane.getByText('Which table holds books?')).toBeVisible()
  await expect(pane.getByText(/could not be reached|request failed/i)).toBeVisible({
    timeout: 20_000,
  })
})

test('keeps the conversation across a reload and clears it on demand', async ({ page }) => {
  // Runs after the configuring test in this file (serial: workers=1), so a provider is set.
  await connect(page)

  const pane = page.getByRole('complementary')
  await expect(pane.getByText('test-model')).toBeVisible()

  const composer = pane.getByPlaceholder('Ask the navigator…')
  await composer.fill('A remembered question')
  await pane.getByRole('button', { name: 'Send' }).click()
  await expect(pane.getByText('A remembered question')).toBeVisible()
  // Let the turn settle (error arrives) so it is persisted.
  await expect(pane.getByText(/could not be reached|request failed/i)).toBeVisible({
    timeout: 20_000,
  })

  // A reload restores the conversation from storage.
  await page.reload()
  await expect(pane.getByText('test-model')).toBeVisible({ timeout: 15_000 })
  await expect(pane.getByText('A remembered question')).toBeVisible()

  // Clearing removes it, and it stays gone after another reload.
  await pane.getByRole('button', { name: 'Clear conversation' }).click()
  await expect(pane.getByText('A remembered question')).toBeHidden()
  await page.reload()
  await expect(pane.getByText('test-model')).toBeVisible({ timeout: 15_000 })
  await expect(pane.getByText('A remembered question')).toBeHidden()
})
