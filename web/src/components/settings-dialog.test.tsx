import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// t returns the key; useSettings is stubbed so the dialog can be tested in isolation.
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const update = vi.fn()
const settingsValue = {
  theme: 'system' as const,
  showViewDependencies: true,
  defaultView: 'neighbourhood' as const,
}
vi.mock('@/lib/settings', () => ({
  useSettings: () => ({ settings: settingsValue, update }),
}))

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  fetchHealth: vi.fn(),
  fetchAiProvider: vi.fn(),
  saveAiProvider: vi.fn(),
  clearAiProvider: vi.fn(),
}))

import { SettingsDialog } from '@/components/settings-dialog'
import {
  type AiProvider,
  clearAiProvider,
  fetchAiProvider,
  fetchHealth,
  saveAiProvider,
} from '@/lib/api'

const mockHealth = vi.mocked(fetchHealth)
const mockFetchProvider = vi.mocked(fetchAiProvider)
const mockSaveProvider = vi.mocked(saveAiProvider)
const mockClearProvider = vi.mocked(clearAiProvider)

afterEach(() => {
  update.mockReset()
  mockHealth.mockReset()
  mockFetchProvider.mockReset()
  mockSaveProvider.mockReset()
  mockClearProvider.mockReset()
})

function renderDialog(open = true, provider: AiProvider | null = null) {
  mockHealth.mockResolvedValue({ status: 'ok', version: '9.9.9' })
  mockFetchProvider.mockResolvedValue(provider)
  const onClose = vi.fn()
  render(<SettingsDialog open={open} onClose={onClose} />)
  return { onClose }
}

describe('SettingsDialog', () => {
  it('renders nothing when closed', () => {
    renderDialog(false)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('updates the theme when another option is picked', () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'settings.themeDark' }))

    expect(update).toHaveBeenCalledWith({ theme: 'dark' })
  })

  it('toggles the view-dependencies switch', () => {
    renderDialog()

    fireEvent.click(screen.getByRole('switch', { name: 'settings.showViewDependencies' }))

    // The switch is on, so toggling sends false.
    expect(update).toHaveBeenCalledWith({ showViewDependencies: false })
  })

  it('changes the default view', () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'settings.viewAll' }))

    expect(update).toHaveBeenCalledWith({ defaultView: 'all' })
  })

  it('shows the running version from the health check', async () => {
    renderDialog()

    expect(await screen.findByText('9.9.9')).toBeInTheDocument()
  })

  it('closes on Escape and on the close button', () => {
    const { onClose } = renderDialog()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'settings.close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('moves focus into the dialog when opened and restores it on close', () => {
    mockHealth.mockResolvedValue({ status: 'ok', version: '9.9.9' })
    mockFetchProvider.mockResolvedValue(null)
    // A trigger outside the dialog holds focus before it opens.
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    expect(trigger).toHaveFocus()

    const { rerender } = render(<SettingsDialog open onClose={vi.fn()} />)
    // Focus has moved inside the dialog.
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)

    rerender(<SettingsDialog open={false} onClose={vi.fn()} />)
    // On close, focus returns to the trigger.
    expect(trigger).toHaveFocus()
    trigger.remove()
  })

  it('keeps Tab within the dialog (focus trap wraps at the ends)', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog')
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button'))
    const first = focusables[0]
    const last = focusables[focusables.length - 1]

    // Tab off the last element wraps to the first.
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(first).toHaveFocus()

    // Shift+Tab off the first wraps to the last.
    first.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
  })
})

describe('SettingsDialog — AI provider', () => {
  const configured: AiProvider = {
    kind: 'anthropic',
    model: 'claude-sonnet-5',
    base_url: null,
    has_api_key: true,
  }

  it('seeds the form with sensible defaults when nothing is configured', async () => {
    renderDialog()

    // The model defaults to the recommended Claude model; no Remove action is shown.
    expect(await screen.findByLabelText('settings.aiModel')).toHaveValue('claude-opus-4-8')
    expect(screen.queryByRole('button', { name: 'settings.aiRemove' })).not.toBeInTheDocument()
    expect(screen.getByText('settings.aiNotConfigured')).toBeInTheDocument()
  })

  it('loads the configured provider and marks the key as stored', async () => {
    renderDialog(true, configured)

    expect(await screen.findByLabelText('settings.aiModel')).toHaveValue('claude-sonnet-5')
    // The stored key is never fetched back — the field is blank with a "stored" placeholder.
    const key = screen.getByLabelText('settings.aiApiKey')
    expect(key).toHaveValue('')
    expect(key).toHaveAttribute('placeholder', 'settings.aiApiKeyStored')
    expect(screen.getByRole('button', { name: 'settings.aiRemove' })).toBeInTheDocument()
  })

  it('saves the provider, sending a typed key and omitting a blank one', async () => {
    mockSaveProvider.mockResolvedValue(configured)
    renderDialog()
    await screen.findByLabelText('settings.aiModel')

    fireEvent.change(screen.getByLabelText('settings.aiModel'), {
      target: { value: 'claude-opus-4-8' },
    })
    fireEvent.change(screen.getByLabelText('settings.aiApiKey'), { target: { value: 'sk-typed' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.aiSave' }))

    await screen.findByText('settings.aiSaved')
    expect(mockSaveProvider).toHaveBeenCalledWith({
      kind: 'anthropic',
      model: 'claude-opus-4-8',
      base_url: null,
      api_key: 'sk-typed',
    })
  })

  it('keeps the stored key when saving with the field left blank', async () => {
    mockSaveProvider.mockResolvedValue(configured)
    renderDialog(true, configured)
    await screen.findByLabelText('settings.aiModel')

    fireEvent.click(screen.getByRole('button', { name: 'settings.aiSave' }))

    await screen.findByText('settings.aiSaved')
    // No api_key in the payload — the backend leaves the stored key untouched.
    expect(mockSaveProvider).toHaveBeenCalledWith({
      kind: 'anthropic',
      model: 'claude-sonnet-5',
      base_url: null,
    })
  })

  it('removes the provider', async () => {
    mockClearProvider.mockResolvedValue()
    renderDialog(true, configured)
    await screen.findByRole('button', { name: 'settings.aiRemove' })

    fireEvent.click(screen.getByRole('button', { name: 'settings.aiRemove' }))

    expect(mockClearProvider).toHaveBeenCalledOnce()
    // Once cleared, the Remove action gives way to the "not configured" note.
    expect(await screen.findByText('settings.aiNotConfigured')).toBeInTheDocument()
  })

  it('surfaces a save error', async () => {
    mockSaveProvider.mockRejectedValue(new Error('An OpenAI-compatible provider needs a base URL.'))
    renderDialog()
    await screen.findByLabelText('settings.aiModel')

    fireEvent.click(screen.getByRole('button', { name: 'settings.aiSave' }))

    expect(await screen.findByText('An OpenAI-compatible provider needs a base URL.')).toBeInTheDocument()
  })

  it('swaps to the kind-specific fields when the tab changes', async () => {
    renderDialog()
    // The Claude tab prefills the recommended model and offers an optional base URL.
    expect(await screen.findByLabelText('settings.aiModel')).toHaveValue('claude-opus-4-8')
    expect(screen.getByLabelText('settings.aiBaseUrlOptional')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'settings.aiKindOpenai' }))

    // The OpenAI-compatible tab resets the model to that kind's default (empty) and shows
    // the required base-URL field instead of the optional one.
    expect(screen.getByLabelText('settings.aiModel')).toHaveValue('')
    expect(screen.getByLabelText('settings.aiBaseUrl')).toBeInTheDocument()
    expect(screen.queryByLabelText('settings.aiBaseUrlOptional')).not.toBeInTheDocument()
  })

  it('marks the configured provider tab as in use', async () => {
    renderDialog(true, configured)
    await screen.findByLabelText('settings.aiModel')

    const claudeTab = screen.getByRole('tab', { name: /settings\.aiKindAnthropic/ })
    expect(claudeTab).toHaveAttribute('aria-selected', 'true')
    expect(claudeTab).toHaveTextContent('settings.aiActive')
    // The other tab is not marked in use.
    expect(screen.getByRole('tab', { name: 'settings.aiKindOpenai' })).not.toHaveTextContent(
      'settings.aiActive',
    )
  })
})
