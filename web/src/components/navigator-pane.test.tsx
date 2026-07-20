import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AiProvider, ChatStreamEvent } from '@/lib/api'

// t returns the key, so tests query by stable keys rather than translated copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

// Replace the streaming call; keep the real types and other exports.
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  streamChat: vi.fn(),
}))

import { NavigatorPane } from '@/components/navigator-pane'
import { streamChat } from '@/lib/api'

const mockStreamChat = vi.mocked(streamChat)

const LOCAL: AiProvider = {
  kind: 'openai_compatible',
  model: 'llama3.1',
  base_url: 'http://localhost:11434/v1',
  has_api_key: false,
}
const HOSTED: AiProvider = {
  kind: 'anthropic',
  model: 'claude-opus-4-8',
  base_url: null,
  has_api_key: true,
}

/** Make streamChat yield the given events. */
function streamsBack(events: ChatStreamEvent[]): void {
  mockStreamChat.mockImplementation(async function* () {
    for (const event of events) {
      yield event
    }
  })
}

/** Recognises the handful of objects the tests talk about. */
const RESOLVER = (text: string): string | null =>
  ({ 'public.rental': 'public.rental', rental: 'public.rental' })[text.trim()] ?? null

function renderPane(provider: AiProvider | null, approved: string[] = []) {
  const onApprove = vi.fn()
  const onOpenSettings = vi.fn()
  const onNavigate = vi.fn()
  render(
    <NavigatorPane
      profileId="p1"
      provider={provider}
      providerLoading={false}
      approved={approved}
      onApprove={onApprove}
      onOpenSettings={onOpenSettings}
      width={288}
      resolveRef={RESOLVER}
      onNavigate={onNavigate}
    />,
  )
  return { onApprove, onOpenSettings, onNavigate }
}

function ask(question: string): void {
  const box = screen.getByLabelText('chat.inputPlaceholder')
  fireEvent.change(box, { target: { value: question } })
  fireEvent.click(screen.getByLabelText('chat.send'))
}

beforeEach(() => {
  mockStreamChat.mockReset()
  streamsBack([{ type: 'text', text: 'Hello.' }, { type: 'done', usage: { input_tokens: 1, output_tokens: 1 } }])
})

afterEach(() => {
  localStorage.clear()
})

describe('NavigatorPane', () => {
  it('sends straight to a local provider without asking for consent', async () => {
    const { onApprove } = renderPane(LOCAL)
    expect(screen.getByText('settings.aiPresetOllama')).toBeInTheDocument()
    expect(screen.getByText('llama3.1')).toBeInTheDocument()

    ask('Where do stores live?')

    expect(await screen.findByText('Hello.')).toBeInTheDocument()
    expect(mockStreamChat).toHaveBeenCalledWith(
      'p1',
      [{ role: 'user', content: 'Where do stores live?' }],
      expect.any(AbortSignal),
    )
    expect(onApprove).not.toHaveBeenCalled()
  })

  it('asks for consent before a first send to a remote provider, then sends on confirm', async () => {
    const { onApprove } = renderPane(HOSTED)
    expect(screen.getByText('settings.aiPresetClaude')).toBeInTheDocument()
    expect(screen.getByText('claude-opus-4-8')).toBeInTheDocument()

    ask('Hi')

    // The consent gate is shown and nothing has been sent yet.
    expect(screen.getByText('chat.consentTitle')).toBeInTheDocument()
    expect(mockStreamChat).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('chat.consentConfirm'))

    expect(onApprove).toHaveBeenCalledWith('anthropic')
    expect(await screen.findByText('Hello.')).toBeInTheDocument()
    expect(mockStreamChat).toHaveBeenCalledTimes(1)
  })

  it('does not ask again once the remote destination is approved', async () => {
    renderPane(HOSTED, ['anthropic'])

    ask('Hi')

    expect(screen.queryByText('chat.consentTitle')).not.toBeInTheDocument()
    expect(await screen.findByText('Hello.')).toBeInTheDocument()
  })

  it('renders the answer as Markdown rather than raw text', async () => {
    streamsBack([
      {
        type: 'text',
        text: '**Columns**\n\n| Column | Type |\n| --- | --- |\n| `id` | integer |\n',
      },
      { type: 'done', usage: { input_tokens: 1, output_tokens: 1 } },
    ])
    renderPane(LOCAL)

    ask('Hi')

    // The emphasis and table became elements; no Markdown punctuation is left on screen.
    expect(await screen.findByText('Columns')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Column' })).toBeInTheDocument()
    expect(screen.getByText('id')).toBeInTheDocument()
    expect(screen.queryByText(/\*\*Columns\*\*/)).not.toBeInTheDocument()
  })

  it('reports look-ups by count, never by internal tool name', async () => {
    streamsBack([
      { type: 'tool_call', name: 'search_objects' },
      { type: 'tool_call', name: 'get_object' },
      { type: 'text', text: 'Done.' },
      { type: 'done', usage: { input_tokens: 1, output_tokens: 1 } },
    ])
    renderPane(LOCAL)

    ask('Hi')

    await screen.findByText('Done.')
    expect(screen.getByText('chat.lookedUp')).toBeInTheDocument()
    expect(screen.queryByText(/search_objects/)).not.toBeInTheDocument()
    expect(screen.queryByText(/get_object/)).not.toBeInTheDocument()
  })

  it('turns a named table into a link that recentres the map', async () => {
    streamsBack([
      { type: 'text', text: 'Rentals live in `public.rental`, joined to `film_actor`.' },
      { type: 'done', usage: { input_tokens: 1, output_tokens: 1 } },
    ])
    const { onNavigate } = renderPane(LOCAL)

    ask('Hi')

    const link = await screen.findByRole('button', { name: 'public.rental' })
    fireEvent.click(link)
    expect(onNavigate).toHaveBeenCalledWith('public.rental')

    // A code span the schema does not know stays plain text, not a link.
    expect(screen.queryByRole('button', { name: 'film_actor' })).not.toBeInTheDocument()
    expect(screen.getByText('film_actor')).toBeInTheDocument()
  })

  it('links a table named in bold, which the navigator also uses', async () => {
    streamsBack([
      { type: 'text', text: 'It references the **public.rental** table, which is **large**.' },
      { type: 'done', usage: { input_tokens: 1, output_tokens: 1 } },
    ])
    const { onNavigate } = renderPane(LOCAL)

    ask('Hi')

    fireEvent.click(await screen.findByRole('button', { name: 'public.rental' }))
    expect(onNavigate).toHaveBeenCalledWith('public.rental')
    // Ordinary emphasis is left alone.
    expect(screen.queryByRole('button', { name: 'large' })).not.toBeInTheDocument()
    expect(screen.getByText('large')).toBeInTheDocument()
  })

  it('links a bare table name to its qualified object', async () => {
    streamsBack([
      { type: 'text', text: 'See `rental`.' },
      { type: 'done', usage: { input_tokens: 1, output_tokens: 1 } },
    ])
    const { onNavigate } = renderPane(LOCAL)

    ask('Hi')

    fireEvent.click(await screen.findByRole('button', { name: 'rental' }))
    expect(onNavigate).toHaveBeenCalledWith('public.rental')
  })

  it('shows what an answer cost when the provider reports it', async () => {
    streamsBack([
      { type: 'text', text: 'Done.' },
      { type: 'done', usage: { input_tokens: 2147, output_tokens: 376 } },
    ])
    renderPane(LOCAL)

    ask('Hi')

    await screen.findByText('Done.')
    expect(screen.getByText('chat.usage')).toBeInTheDocument()
  })

  it('keeps the conversation and reads it back for the same profile', async () => {
    renderPane(LOCAL)

    ask('Where do stores live?')
    await screen.findByText('Hello.')

    // Remount as the same profile: the thread is still there, without asking again.
    cleanup()
    mockStreamChat.mockClear()
    renderPane(LOCAL)

    expect(screen.getByText('Where do stores live?')).toBeInTheDocument()
    expect(screen.getByText('Hello.')).toBeInTheDocument()
    expect(mockStreamChat).not.toHaveBeenCalled()
  })

  it('clears the conversation, and it stays cleared', async () => {
    renderPane(LOCAL)
    ask('Hi')
    await screen.findByText('Hello.')

    fireEvent.click(screen.getByLabelText('chat.clear'))

    expect(screen.queryByText('Hello.')).not.toBeInTheDocument()
    // The intro is back, and a remount does not resurrect the thread.
    cleanup()
    renderPane(LOCAL)
    expect(screen.queryByText('Hello.')).not.toBeInTheDocument()
    expect(screen.getByText('panes.chatIntro')).toBeInTheDocument()
  })

  it('offers no clear action while the conversation is empty', () => {
    renderPane(LOCAL)

    expect(screen.queryByLabelText('chat.clear')).not.toBeInTheDocument()
  })

  it('surfaces a streamed error as an inline message', async () => {
    streamsBack([{ type: 'error', message: 'The AI provider could not be reached.' }])
    renderPane(LOCAL)

    ask('Hi')

    expect(await screen.findByText('The AI provider could not be reached.')).toBeInTheDocument()
  })

  it('disables the composer and offers to configure when no provider is set', () => {
    const { onOpenSettings } = renderPane(null)

    expect(screen.getByLabelText('chat.inputPlaceholder')).toBeDisabled()
    expect(screen.getByText('chat.noProvider')).toBeInTheDocument()
    fireEvent.click(screen.getByText('chat.configure'))
    expect(onOpenSettings).toHaveBeenCalled()
  })

  it('cancels the consent gate without sending', async () => {
    renderPane(HOSTED)

    ask('Hi')
    fireEvent.click(screen.getByText('chat.consentCancel'))

    await waitFor(() => expect(screen.queryByText('chat.consentTitle')).not.toBeInTheDocument())
    expect(mockStreamChat).not.toHaveBeenCalled()
  })
})
