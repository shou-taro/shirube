import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  testAiProvider: vi.fn(),
  clearAiProvider: vi.fn(),
}))

import { SettingsDialog } from '@/components/settings-dialog'
import {
  type AiProvider,
  clearAiProvider,
  fetchAiProvider,
  fetchHealth,
  saveAiProvider,
  testAiProvider,
} from '@/lib/api'

const mockHealth = vi.mocked(fetchHealth)
const mockFetchProvider = vi.mocked(fetchAiProvider)
const mockSaveProvider = vi.mocked(saveAiProvider)
const mockTestProvider = vi.mocked(testAiProvider)
const mockClearProvider = vi.mocked(clearAiProvider)

afterEach(() => {
  update.mockReset()
  mockHealth.mockReset()
  mockFetchProvider.mockReset()
  mockSaveProvider.mockReset()
  mockTestProvider.mockReset()
  mockClearProvider.mockReset()
})

function renderDialog(open = true, provider: AiProvider | null = null, approved: string[] = []) {
  mockHealth.mockResolvedValue({ status: 'ok', version: '9.9.9' })
  mockFetchProvider.mockResolvedValue(provider)
  const onClose = vi.fn()
  const onRevoke = vi.fn()
  render(
    <SettingsDialog open={open} onClose={onClose} approved={approved} onRevoke={onRevoke} />,
  )
  return { onClose, onRevoke }
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
    fireEvent.click(screen.getByRole('button', { name: 'settings.erMap' }))

    fireEvent.click(screen.getByRole('switch', { name: 'settings.showViewDependencies' }))

    // The switch is on, so toggling sends false.
    expect(update).toHaveBeenCalledWith({ showViewDependencies: false })
  })

  it('changes the default view', () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'settings.erMap' }))

    fireEvent.click(screen.getByRole('button', { name: 'settings.viewAll' }))

    expect(update).toHaveBeenCalledWith({ defaultView: 'all' })
  })

  it('shows the running version from the health check', async () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'settings.about' }))

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
  const configuredClaude: AiProvider = {
    kind: 'anthropic',
    model: 'claude-sonnet-5',
    base_url: null,
    context_window: null,
    has_api_key: true,
  }

  // Render the dialog, open the AI navigator group (its own tab in the grouped settings),
  // and wait for the provider form to load.
  async function openAiSection(provider: AiProvider | null = null): Promise<void> {
    renderDialog(true, provider)
    fireEvent.click(screen.getByRole('button', { name: 'settings.ai' }))
    await screen.findByLabelText('settings.aiProviderLabel')
  }

  it('shows the Claude defaults when nothing is configured', async () => {
    await openAiSection(null)

    // Defaults to the Claude preset with its recommended model; no Remove action yet.
    expect(screen.getByLabelText('settings.aiProviderLabel')).toHaveValue('claude')
    expect(screen.getByLabelText('settings.aiModel')).toHaveValue('claude-opus-4-8')
    expect(screen.queryByRole('button', { name: 'settings.aiRemove' })).not.toBeInTheDocument()
  })

  it('loads the configured provider and marks the key as saved', async () => {
    await openAiSection(configuredClaude)

    expect(screen.getByLabelText('settings.aiProviderLabel')).toHaveValue('claude')
    expect(screen.getByLabelText('settings.aiModel')).toHaveValue('claude-sonnet-5')
    // The stored key is never fetched back — the field is blank with a "saved" hint.
    expect(screen.getByLabelText('settings.aiApiKey')).toHaveValue('')
    expect(screen.getByText('settings.aiApiKeySaved')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.aiRemove' })).toBeInTheDocument()
  })

  it('swaps to the provider-specific fields when the selection changes', async () => {
    await openAiSection(null)
    // Claude asks for a key and hides the base URL and the context window (its window is large).
    expect(screen.getByLabelText('settings.aiApiKey')).toBeInTheDocument()
    expect(screen.queryByLabelText('settings.aiBaseUrl')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('settings.aiContextWindow')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('settings.aiProviderLabel'), {
      target: { value: 'ollama' },
    })

    // Ollama shows its base URL (prefilled), resets the model, needs no key, and shows the
    // context-window field seeded with its default.
    expect(screen.getByLabelText('settings.aiBaseUrl')).toHaveValue('http://localhost:11434/v1')
    expect(screen.getByLabelText('settings.aiModel')).toHaveValue('')
    expect(screen.queryByLabelText('settings.aiApiKey')).not.toBeInTheDocument()
    expect(screen.getByLabelText('settings.aiContextWindow')).toHaveValue(4096)
  })

  it('sends an edited context window, and seeds it from a saved provider', async () => {
    mockSaveProvider.mockResolvedValue({
      kind: 'openai_compatible',
      model: 'llama3.1',
      base_url: 'http://localhost:11434/v1',
      context_window: 16384,
      has_api_key: false,
    })
    await openAiSection(null)
    fireEvent.change(screen.getByLabelText('settings.aiProviderLabel'), {
      target: { value: 'ollama' },
    })
    fireEvent.change(screen.getByLabelText('settings.aiModel'), { target: { value: 'llama3.1' } })
    fireEvent.change(screen.getByLabelText('settings.aiContextWindow'), {
      target: { value: '16384' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'settings.aiSave' }))

    await screen.findByText('settings.aiSaved')
    expect(mockSaveProvider).toHaveBeenCalledWith({
      kind: 'openai_compatible',
      model: 'llama3.1',
      base_url: 'http://localhost:11434/v1',
      context_window: 16384,
    })
  })

  it('seeds the context-window field from the saved provider on load', async () => {
    await openAiSection({
      kind: 'openai_compatible',
      model: 'llama3.1',
      base_url: 'http://localhost:11434/v1',
      context_window: 8192,
      has_api_key: false,
    })

    expect(screen.getByLabelText('settings.aiContextWindow')).toHaveValue(8192)
  })

  it('requires an API key before saving a hosted provider', async () => {
    await openAiSection(null)

    // Claude (a hosted provider) with no key must not be sent to the backend.
    fireEvent.click(screen.getByRole('button', { name: 'settings.aiSave' }))

    expect(await screen.findByText('settings.aiApiKeyMissing')).toBeInTheDocument()
    expect(mockSaveProvider).not.toHaveBeenCalled()
  })

  it('saves a local Ollama provider without a key', async () => {
    mockSaveProvider.mockResolvedValue({
      kind: 'openai_compatible',
      model: 'llama3.1',
      base_url: 'http://localhost:11434/v1',
      context_window: 4096,
      has_api_key: false,
    })
    await openAiSection(null)

    fireEvent.change(screen.getByLabelText('settings.aiProviderLabel'), {
      target: { value: 'ollama' },
    })
    fireEvent.change(screen.getByLabelText('settings.aiModel'), { target: { value: 'llama3.1' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.aiSave' }))

    await screen.findByText('settings.aiSaved')
    // The local endpoint is sent with no api_key field, and Ollama's default window.
    expect(mockSaveProvider).toHaveBeenCalledWith({
      kind: 'openai_compatible',
      model: 'llama3.1',
      base_url: 'http://localhost:11434/v1',
      context_window: 4096,
    })
  })

  it('sends the fixed OpenAI endpoint and a typed key', async () => {
    mockSaveProvider.mockResolvedValue(configuredClaude)
    await openAiSection(null)

    fireEvent.change(screen.getByLabelText('settings.aiProviderLabel'), {
      target: { value: 'openai' },
    })
    // Hosted OpenAI hides the context-window field (like Claude); its large window is sent
    // automatically.
    expect(screen.queryByLabelText('settings.aiContextWindow')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('settings.aiModel'), { target: { value: 'gpt-4o' } })
    fireEvent.change(screen.getByLabelText('settings.aiApiKey'), { target: { value: 'sk-typed' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.aiSave' }))

    await screen.findByText('settings.aiSaved')
    // OpenAI's base URL is fixed (the field is hidden) and included automatically, together
    // with its large default context window.
    expect(mockSaveProvider).toHaveBeenCalledWith({
      kind: 'openai_compatible',
      model: 'gpt-4o',
      base_url: 'https://api.openai.com/v1',
      context_window: 128000,
      api_key: 'sk-typed',
    })
  })

  it('keeps the stored key when re-saving the configured provider', async () => {
    mockSaveProvider.mockResolvedValue(configuredClaude)
    await openAiSection(configuredClaude)

    fireEvent.click(screen.getByRole('button', { name: 'settings.aiSave' }))

    await screen.findByText('settings.aiSaved')
    // No api_key — the stored one is kept — and no missing-key error, since it is saved.
    expect(mockSaveProvider).toHaveBeenCalledWith({
      kind: 'anthropic',
      model: 'claude-sonnet-5',
      base_url: null,
    })
  })

  it('verifies the provider before saving, and does not save when the check fails', async () => {
    mockTestProvider.mockRejectedValue(new Error('The provider rejected the API key.'))
    await openAiSection(null)

    fireEvent.change(screen.getByLabelText('settings.aiProviderLabel'), {
      target: { value: 'openai' },
    })
    fireEvent.change(screen.getByLabelText('settings.aiModel'), { target: { value: 'gpt-4o' } })
    fireEvent.change(screen.getByLabelText('settings.aiApiKey'), { target: { value: 'sk-typed' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.aiSave' }))

    expect(await screen.findByText('The provider rejected the API key.')).toBeInTheDocument()
    // The check ran but failed, so nothing is stored.
    expect(mockTestProvider).toHaveBeenCalled()
    expect(mockSaveProvider).not.toHaveBeenCalled()
  })

  it('removes the provider', async () => {
    mockClearProvider.mockResolvedValue()
    await openAiSection(configuredClaude)
    expect(screen.getByRole('button', { name: 'settings.aiRemove' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'settings.aiRemove' }))

    expect(mockClearProvider).toHaveBeenCalledOnce()
    // Once cleared, the provider is no longer configured, so Remove disappears.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'settings.aiRemove' })).not.toBeInTheDocument(),
    )
  })

  it('surfaces a save error from the backend', async () => {
    mockSaveProvider.mockRejectedValue(new Error('The database took too long.'))
    await openAiSection(null)

    // Provide a key so the client-side guard passes and the request is actually made.
    fireEvent.change(screen.getByLabelText('settings.aiApiKey'), { target: { value: 'sk-x' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.aiSave' }))

    expect(await screen.findByText('The database took too long.')).toBeInTheDocument()
  })

  it('surfaces a remove error from the backend', async () => {
    mockClearProvider.mockRejectedValue(new Error('The keychain is locked.'))
    await openAiSection(configuredClaude)

    fireEvent.click(screen.getByRole('button', { name: 'settings.aiRemove' }))

    expect(await screen.findByText('The keychain is locked.')).toBeInTheDocument()
  })

  it('edits the base URL for an OpenAI-compatible endpoint', async () => {
    mockSaveProvider.mockResolvedValue({
      kind: 'openai_compatible',
      model: 'llama3.1',
      base_url: 'http://box:11434/v1',
      context_window: 4096,
      has_api_key: false,
    })
    await openAiSection(null)
    fireEvent.change(screen.getByLabelText('settings.aiProviderLabel'), {
      target: { value: 'ollama' },
    })

    fireEvent.change(screen.getByLabelText('settings.aiBaseUrl'), {
      target: { value: 'http://box:11434/v1' },
    })
    fireEvent.change(screen.getByLabelText('settings.aiModel'), { target: { value: 'llama3.1' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.aiSave' }))

    await screen.findByText('settings.aiSaved')
    expect(mockSaveProvider).toHaveBeenCalledWith({
      kind: 'openai_compatible',
      model: 'llama3.1',
      base_url: 'http://box:11434/v1',
      context_window: 4096,
    })
  })

  it('falls back to the Claude defaults when the provider lookup fails', async () => {
    mockHealth.mockResolvedValue({ status: 'ok', version: '9.9.9' })
    mockFetchProvider.mockRejectedValue(new Error('offline'))
    render(<SettingsDialog open onClose={vi.fn()} approved={[]} onRevoke={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'settings.ai' }))

    await screen.findByLabelText('settings.aiProviderLabel')
    expect(screen.getByLabelText('settings.aiProviderLabel')).toHaveValue('claude')
  })

  it('lists approved destinations and revokes one', async () => {
    mockHealth.mockResolvedValue({ status: 'ok', version: '9.9.9' })
    mockFetchProvider.mockResolvedValue(null)
    const onRevoke = vi.fn()
    render(<SettingsDialog open onClose={vi.fn()} approved={['anthropic']} onRevoke={onRevoke} />)
    fireEvent.click(screen.getByRole('button', { name: 'settings.ai' }))
    await screen.findByLabelText('settings.aiProviderLabel')

    expect(screen.getByText('Claude')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'settings.aiRevoke' }))

    expect(onRevoke).toHaveBeenCalledWith('anthropic')
  })
})

describe('SettingsDialog — About', () => {
  it('shows a dash for the version when the health check fails', async () => {
    mockHealth.mockRejectedValue(new Error('down'))
    mockFetchProvider.mockResolvedValue(null)
    render(<SettingsDialog open onClose={vi.fn()} approved={[]} onRevoke={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'settings.about' }))

    await waitFor(() => expect(screen.getByText('—')).toBeInTheDocument())
  })
})
