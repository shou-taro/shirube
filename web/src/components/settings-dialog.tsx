import { Check, Monitor, Moon, Sun, X } from 'lucide-react'
import { type ComponentType, type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  type AiProvider,
  type AiProviderInput,
  type AiProviderKind,
  clearAiProvider,
  fetchAiProvider,
  fetchHealth,
  saveAiProvider,
} from '@/lib/api'
import { useSettings } from '@/lib/settings'
import { cn } from '@/lib/utils'

/** A labelled block within the dialog. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-border/60 px-5 py-4 first:border-t-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  )
}

/** A label with optional hint on the left, and its control on the right. */
function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/** A small segmented control: one option highlighted, the rest quiet. Options may carry
 *  an icon, shown before the label. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string; icon?: ComponentType<{ className?: string }> }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="flex rounded-md border bg-background p-0.5">
      {options.map((option) => {
        const Icon = option.icon
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium',
              option.value === value
                ? 'bg-brand text-brand-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {Icon ? <Icon className="size-3.5" /> : null}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** A pill toggle for a boolean setting. */
function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors',
        checked ? 'bg-brand' : 'bg-input',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 size-4 rounded-full bg-card shadow-sm transition-all',
          checked ? 'left-[1.125rem]' : 'left-0.5',
        )}
      />
    </button>
  )
}

/** A labelled text field stacked vertically, for the provider form. The hint sits outside
 *  the label so it does not become part of the control's accessible name. */
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        <span className="text-sm">{label}</span>
        {children}
      </label>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  )
}

/**
 * The AI-navigator provider settings: which adapter, model and base URL, plus the API key.
 * Unlike the instant-apply toggles above, this is a server-backed form — it loads the
 * current provider when the dialog opens and saves on demand. The API key is write-only:
 * it is stored in the OS keychain and never read back, so a stored key shows as a
 * placeholder and a blank field keeps it. No provider is configured until the user sets one.
 */
function AiProviderSection({ open }: { open: boolean }) {
  const { t } = useTranslation()
  const [provider, setProvider] = useState<AiProvider | null | undefined>(undefined)
  const [kind, setKind] = useState<AiProviderKind>('anthropic')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Load the configured provider each time the dialog opens, seeding the form from it (or
  // from sensible defaults when nothing is configured yet). The key field always starts
  // blank — the stored key is never sent back to the client.
  useEffect(() => {
    if (!open) {
      return
    }
    let active = true
    setError(null)
    setSaved(false)
    setApiKey('')
    fetchAiProvider()
      .then((current) => {
        if (!active) {
          return
        }
        setProvider(current)
        setKind(current?.kind ?? 'anthropic')
        setModel(current?.model ?? 'claude-opus-4-8')
        setBaseUrl(current?.base_url ?? '')
      })
      .catch(() => {
        if (active) {
          setProvider(null)
        }
      })
    return () => {
      active = false
    }
  }, [open])

  async function handleSave(): Promise<void> {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const input: AiProviderInput = {
        kind,
        model,
        base_url: baseUrl.trim() === '' ? null : baseUrl.trim(),
      }
      // Only send a key when one was typed; a blank field keeps the stored key.
      if (apiKey !== '') {
        input.api_key = apiKey
      }
      const result = await saveAiProvider(input)
      setProvider(result)
      setApiKey('')
      setSaved(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove(): Promise<void> {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await clearAiProvider()
      setProvider(null)
      setKind('anthropic')
      setModel('claude-opus-4-8')
      setBaseUrl('')
      setApiKey('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }

  const configured = provider != null
  const keyPlaceholder = provider?.has_api_key
    ? t('settings.aiApiKeyStored')
    : kind === 'openai_compatible'
      ? t('settings.aiApiKeyOptional')
      : ''

  return (
    <Section title={t('settings.ai')}>
      <Row label={t('settings.aiProvider')} hint={t('settings.aiProviderHint')}>
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'anthropic', label: t('settings.aiKindAnthropic') },
            { value: 'openai_compatible', label: t('settings.aiKindOpenai') },
          ]}
        />
      </Row>
      <Field label={t('settings.aiModel')}>
        <Input
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder="claude-opus-4-8"
        />
      </Field>
      <Field label={t('settings.aiBaseUrl')} hint={t('settings.aiBaseUrlHint')}>
        <Input
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder={kind === 'openai_compatible' ? 'http://localhost:11434/v1' : ''}
        />
      </Field>
      <Field label={t('settings.aiApiKey')} hint={t('settings.aiApiKeyHint')}>
        <Input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={keyPlaceholder}
          autoComplete="off"
        />
      </Field>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex items-center gap-2">
        <Button variant="brand" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? t('settings.aiSaving') : t('settings.aiSave')}
        </Button>
        {configured ? (
          <Button variant="ghost" size="sm" onClick={handleRemove} disabled={saving}>
            {t('settings.aiRemove')}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">{t('settings.aiNotConfigured')}</span>
        )}
        {saved ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Check className="size-3.5" />
            {t('settings.aiSaved')}
          </span>
        ) : null}
      </div>
    </Section>
  )
}

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
}

/**
 * The settings modal: appearance (theme), ER map defaults and an About section. Opened
 * from the top bar's gear. A light overlay; Escape or a click outside closes it.
 */
export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const { t } = useTranslation()
  const { settings, update } = useSettings()
  const [version, setVersion] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // Manage focus while the modal is open: move focus in, keep Tab inside it, close on
  // Escape, and hand focus back to whatever opened it on close. Without this, focus stays
  // behind the overlay and Tab walks the page underneath.
  useEffect(() => {
    if (!open) {
      return
    }
    const previouslyFocused = document.activeElement as HTMLElement | null
    const focusable = (): HTMLElement[] => {
      const dialog = dialogRef.current
      if (dialog === null) {
        return []
      }
      return Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute('disabled'))
    }
    // Move focus into the dialog (the first control, or the dialog itself as a fallback).
    ;(focusable()[0] ?? dialogRef.current)?.focus()

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') {
        return
      }
      const items = focusable()
      if (items.length === 0) {
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      // Wrap at the ends so Tab / Shift+Tab cycle within the dialog rather than escaping.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  // Read the running version when the dialog opens.
  useEffect(() => {
    if (!open) {
      return
    }
    fetchHealth()
      .then((health) => setVersion(health.version))
      .catch(() => setVersion(null))
  }, [open])

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.title')}
        tabIndex={-1}
        className="relative z-10 flex w-full max-w-md flex-col overflow-hidden rounded-xl border bg-card shadow-lg outline-none"
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-sm font-medium">{t('settings.title')}</h2>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onClose}
            aria-label={t('settings.close')}
          >
            <X className="size-4" />
          </Button>
        </div>

        <Section title={t('settings.appearance')}>
          <Row label={t('settings.theme')}>
            <Segmented
              value={settings.theme}
              onChange={(theme) => update({ theme })}
              options={[
                { value: 'system', label: t('settings.themeSystem'), icon: Monitor },
                { value: 'light', label: t('settings.themeLight'), icon: Sun },
                { value: 'dark', label: t('settings.themeDark'), icon: Moon },
              ]}
            />
          </Row>
        </Section>

        <Section title={t('settings.erMap')}>
          <Row label={t('settings.showViewDependencies')} hint={t('settings.showViewDependenciesHint')}>
            <Switch
              checked={settings.showViewDependencies}
              onChange={(showViewDependencies) => update({ showViewDependencies })}
              label={t('settings.showViewDependencies')}
            />
          </Row>
          <Row label={t('settings.defaultView')} hint={t('settings.defaultViewHint')}>
            <Segmented
              value={settings.defaultView}
              onChange={(defaultView) => update({ defaultView })}
              options={[
                { value: 'neighbourhood', label: t('settings.viewNeighbourhood') },
                { value: 'all', label: t('settings.viewAll') },
              ]}
            />
          </Row>
        </Section>

        <AiProviderSection open={open} />

        <Section title={t('settings.about')}>
          <Row label={t('settings.version')}>
            <span className="text-sm text-muted-foreground">{version ?? '—'}</span>
          </Row>
        </Section>
      </div>
    </div>
  )
}
