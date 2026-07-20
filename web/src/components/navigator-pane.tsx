import { ArrowUp, Globe, HardDrive, Loader2, Settings2, Sparkles, Square } from 'lucide-react'
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { type AiProvider, type ChatMessage, streamChat } from '@/lib/api'
import { describeDestination, isDestinationTrusted } from '@/lib/destinations'
import { cn } from '@/lib/utils'

/** One rendered turn of the conversation. Assistant turns grow as the answer streams in. */
interface Turn {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** Tools the assistant looked up this turn (assistant turns only). */
  tools: string[]
  /** A user-safe error that ended this turn, if any (assistant turns only). */
  error: string | null
  /** Whether this assistant turn is still streaming. */
  streaming: boolean
}

interface NavigatorPaneProps {
  /** The connected profile whose schema questions are about. */
  profileId: string
  /** The configured AI provider, or null when none is set. */
  provider: AiProvider | null
  /** Whether the provider configuration is still loading (avoids flashing the prompt). */
  providerLoading: boolean
  /** Destination keys the user has agreed to send the schema to. */
  trusted: string[]
  /** Remember trust for a destination key (persisted by the owner). */
  onTrust: (key: string) => void
  /** Open the settings dialog, so the user can configure a provider. */
  onOpenSettings: () => void
}

function newId(): string {
  return crypto.randomUUID()
}

/**
 * The AI navigator pane: a conversation, a composer, an always-visible indicator of where
 * the schema is sent, and a one-time consent before it first reaches a remote provider.
 *
 * The answer streams in over Server-Sent Events (see {@link streamChat}); tool look-ups
 * surface only as a "looking things up…" marker, never their arguments or results. Nothing
 * is sent until a provider is configured, and — for a remote provider — not until the user
 * has agreed to that destination.
 */
export function NavigatorPane({
  profileId,
  provider,
  providerLoading,
  trusted,
  onTrust,
  onOpenSettings,
}: NavigatorPaneProps) {
  const { t } = useTranslation()
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  // The pending question held back while the consent gate is shown; null when not gating.
  const [consenting, setConsenting] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const destination = provider === null ? null : describeDestination(provider)

  // Keep the newest turn in view as the answer grows. (Guarded: jsdom has no scrollTo.)
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight })
  }, [turns])

  // Abort any in-flight stream on unmount (e.g. disconnecting).
  useEffect(() => () => abortRef.current?.abort(), [])

  /** Patch the fields of one turn by id. */
  const patchTurn = useCallback((id: string, patch: Partial<Turn>): void => {
    setTurns((current) =>
      current.map((turn) => (turn.id === id ? { ...turn, ...patch } : turn)),
    )
  }, [])

  const run = useCallback(
    async (history: ChatMessage[], assistantId: string): Promise<void> => {
      const controller = new AbortController()
      abortRef.current = controller
      setStreaming(true)
      let text = ''
      const tools: string[] = []
      try {
        for await (const event of streamChat(profileId, history, controller.signal)) {
          if (event.type === 'text') {
            text += event.text
            patchTurn(assistantId, { content: text })
          } else if (event.type === 'tool_call') {
            tools.push(event.name)
            patchTurn(assistantId, { tools: [...tools] })
          } else if (event.type === 'error') {
            patchTurn(assistantId, { error: event.message })
          }
        }
      } catch (error) {
        // An abort is a deliberate stop, not a failure — leave the partial answer as is.
        if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : String(error)
          patchTurn(assistantId, { error: message })
        }
      } finally {
        patchTurn(assistantId, { streaming: false })
        setStreaming(false)
        abortRef.current = null
      }
    },
    [profileId, patchTurn],
  )

  /** Append the question and its (empty) answer turn, then start streaming. */
  const send = useCallback(
    (question: string): void => {
      const userTurn: Turn = {
        id: newId(),
        role: 'user',
        content: question,
        tools: [],
        error: null,
        streaming: false,
      }
      const assistantTurn: Turn = {
        id: newId(),
        role: 'assistant',
        content: '',
        tools: [],
        error: null,
        streaming: true,
      }
      // The history sent up is the prior user/assistant text plus this new question.
      const history: ChatMessage[] = [
        ...turns.map((turn) => ({ role: turn.role, content: turn.content })),
        { role: 'user', content: question },
      ]
      setTurns((current) => [...current, userTurn, assistantTurn])
      void run(history, assistantTurn.id)
    },
    [turns, run],
  )

  const submit = useCallback((): void => {
    const question = input.trim()
    if (question === '' || streaming || destination === null) {
      return
    }
    // A remote, not-yet-trusted destination is confirmed once before anything is sent.
    if (!isDestinationTrusted(destination, trusted)) {
      setConsenting(question)
      return
    }
    setInput('')
    send(question)
  }, [input, streaming, destination, trusted, send])

  const confirmConsent = useCallback((): void => {
    if (destination === null || consenting === null) {
      return
    }
    onTrust(destination.key)
    const question = consenting
    setConsenting(null)
    setInput('')
    send(question)
  }, [destination, consenting, onTrust, send])

  const onInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      // Enter sends; Shift+Enter inserts a newline.
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        submit()
      }
    },
    [submit],
  )

  const composerDisabled = provider === null

  return (
    <aside className="flex h-full w-72 flex-col border-l border-brand/20 bg-brand/10">
      {/* Destination indicator — always visible, so where the schema goes is never hidden. */}
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-brand/20 px-3 text-xs">
        {providerLoading ? (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
          </span>
        ) : destination === null ? (
          <>
            <span className="truncate text-muted-foreground">{t('chat.noProvider')}</span>
            <button
              type="button"
              onClick={onOpenSettings}
              className="ml-auto flex shrink-0 items-center gap-1 font-medium text-brand hover:underline"
            >
              <Settings2 className="size-3.5" />
              {t('chat.configure')}
            </button>
          </>
        ) : destination.isLocal ? (
          <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            <HardDrive className="size-3.5 shrink-0 text-brand" />
            <span className="truncate" title={destination.label}>
              {t('chat.destinationLocal', { label: destination.label })}
            </span>
          </span>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            <Globe className="size-3.5 shrink-0 text-brand" />
            <span className="truncate" title={destination.label}>
              {t('chat.destinationHosted', { label: destination.label })}
            </span>
          </span>
        )}
      </div>

      {/* Conversation, or the intro when empty. */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center text-xs text-muted-foreground">
            <Sparkles className="size-5 text-brand" />
            {t('panes.chatIntro')}
          </div>
        ) : (
          turns.map((turn) =>
            turn.role === 'user' ? (
              <div key={turn.id} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-brand-soft px-3 py-1.5 text-sm text-brand-foreground">
                  {turn.content}
                </div>
              </div>
            ) : (
              <div key={turn.id} className="space-y-1.5 text-sm">
                {turn.tools.length > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {turn.streaming && <Loader2 className="size-3 animate-spin" />}
                    {turn.streaming && turn.content === ''
                      ? t('chat.lookingUp')
                      : t('chat.lookedUp', { tools: turn.tools.join(', ') })}
                  </div>
                )}
                {turn.streaming && turn.content === '' && turn.tools.length === 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" />
                    {t('chat.thinking')}
                  </div>
                )}
                {turn.content !== '' && (
                  <div className="whitespace-pre-wrap break-words text-foreground">
                    {turn.content}
                  </div>
                )}
                {turn.error !== null && (
                  <div className="rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                    {turn.error}
                  </div>
                )}
              </div>
            ),
          )
        )}
      </div>

      {/* Consent gate: shown in place of the composer before a remote first send. */}
      {consenting !== null && destination !== null ? (
        <div className="space-y-2.5 border-t border-brand/20 bg-background/60 p-3">
          <p className="text-sm font-medium">
            {t('chat.consentTitle', { label: destination.label })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('chat.consentBody', { label: destination.label })}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConsenting(null)}>
              {t('chat.consentCancel')}
            </Button>
            <Button variant="brand" size="sm" onClick={confirmConsent}>
              {t('chat.consentConfirm')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="p-2.5">
          <div className="flex items-end gap-2 rounded-lg border bg-background px-2.5 py-1.5 focus-within:ring-1 focus-within:ring-brand">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onInputKeyDown}
              disabled={composerDisabled}
              rows={1}
              placeholder={t('chat.inputPlaceholder')}
              aria-label={t('chat.inputPlaceholder')}
              className="max-h-32 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
            />
            {streaming ? (
              <Button
                variant="brand"
                size="icon"
                className="size-7 shrink-0"
                onClick={() => abortRef.current?.abort()}
                aria-label={t('chat.stop')}
                title={t('chat.stop')}
              >
                <Square className="size-3.5" />
              </Button>
            ) : (
              <Button
                variant="brand"
                size="icon"
                className="size-7 shrink-0"
                onClick={submit}
                disabled={composerDisabled || input.trim() === ''}
                aria-label={t('chat.send')}
                title={t('chat.send')}
              >
                <ArrowUp className={cn('size-4')} />
              </Button>
            )}
          </div>
        </div>
      )}
    </aside>
  )
}
