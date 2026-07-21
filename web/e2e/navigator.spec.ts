import { expect, test } from '@playwright/test'

import { STUB_PROVIDER_URL } from './config'
import { connect } from './helpers'

/**
 * The AI navigator, end to end, without a real model.
 *
 * The provider is pointed at a stub OpenAI-compatible server (see `stub-provider.mjs`) that
 * answers the reachability check — so the provider saves — but serves no real model, so asking
 * a question surfaces an error. That exercises the whole stack (the settings check, the chat
 * route, the tool-calling loop, the provider adapter, the SSE stream and the pane) right up to
 * where a real model would answer.
 *
 * A loopback endpoint counts as local, so nothing leaves the machine and the one-time consent
 * (covered in the unit tests) does not gate the send.
 */

test('configures a provider, then reports that it could not be reached', async ({ page }) => {
  await connect(page)

  const pane = page.getByRole('complementary')

  // The pane starts with no provider and offers to configure one.
  await expect(pane.getByText('No AI provider configured')).toBeVisible()
  await pane.getByRole('button', { name: 'Configure' }).click()

  // The settings dialog opens straight on the AI navigator group.
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Provider')).toBeVisible()

  // Configure a local OpenAI-compatible endpoint (no key) — the stub, which the save-time
  // reachability check reaches, so the provider saves.
  await dialog.getByLabel('Provider').selectOption({ label: 'Ollama (local)' })
  await dialog.getByLabel('Base URL').fill(STUB_PROVIDER_URL)
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

  // The question shows immediately, and the stub (no real model) surfaces as an error —
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
