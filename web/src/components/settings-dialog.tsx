import { Check, Info, Monitor, Moon, Network, Palette, Sparkles, Sun, X } from 'lucide-react'
import { type ComponentType, type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  AI_PRESET_ORDER,
  AI_PRESETS,
  presetForConfig,
  type ProviderPreset,
  saveProviderPreset,
} from '@/lib/ai-presets'
import {
  type AiProvider,
  type AiProviderInput,
  clearAiProvider,
  fetchAiProvider,
  fetchHealth,
  saveAiProvider,
} from '@/lib/api'
import { labelForDestinationId } from '@/lib/destinations'
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
 * The AI-navigator provider settings: pick a provider from the list, then fill only the
 * fields that provider needs — a hosted one asks for an API key, a local one does not, and a
 * custom endpoint asks for its URL. One provider is active at a time; the "in use" line shows
 * which. A server-backed form that loads the current provider when the dialog opens and saves
 * on demand. The API key is write-only — stored in the OS keychain, never read back — so a
 * saved key shows as a note and a blank field keeps it.
 */
function AiProviderSection({
  open,
  approved,
  onRevoke,
}: {
  open: boolean
  approved: string[]
  onRevoke: (id: string) => void
}) {
  const { t } = useTranslation()
  const [provider, setProvider] = useState<AiProvider | null | undefined>(undefined)
  const [preset, setPreset] = useState<ProviderPreset>('claude')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Seed the form for a preset: the saved values when that preset is the configured provider,
  // otherwise the preset's defaults. Always clears the key field — the stored key is never
  // read back — and any transient error/saved state.
  function seedFields(nextPreset: ProviderPreset, current: AiProvider | null): void {
    const spec = AI_PRESETS[nextPreset]
    const fromSaved = current !== null && presetForConfig(current) === nextPreset
    setModel(fromSaved ? current.model : spec.modelDefault)
    setBaseUrl(fromSaved ? (current.base_url ?? '') : spec.baseUrlDefault)
    setApiKey('')
    setError(null)
    setSaved(false)
  }

  // Load the configured provider each time the dialog opens, selecting its preset (or Claude
  // by default) and seeding the form.
  useEffect(() => {
    if (!open) {
      return
    }
    let active = true
    fetchAiProvider()
      .then((current) => {
        if (!active) {
          return
        }
        setProvider(current)
        const nextPreset = current ? presetForConfig(current) : 'claude'
        setPreset(nextPreset)
        const spec = AI_PRESETS[nextPreset]
        const fromSaved = current != null && presetForConfig(current) === nextPreset
        setModel(fromSaved ? current.model : spec.modelDefault)
        setBaseUrl(fromSaved ? (current.base_url ?? '') : spec.baseUrlDefault)
        setApiKey('')
        setError(null)
        setSaved(false)
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

  function selectPreset(next: ProviderPreset): void {
    setPreset(next)
    seedFields(next, provider ?? null)
  }

  const spec = AI_PRESETS[preset]
  const configured = provider != null
  // A stored key only counts as "kept on blank" for the provider it was saved against.
  const keyStored = provider != null && presetForConfig(provider) === preset && provider.has_api_key

  async function handleSave(): Promise<void> {
    // A hosted provider needs a key; guard here so the miss is caught before the request.
    if (spec.key === 'required' && apiKey === '' && !keyStored) {
      setError(t('settings.aiApiKeyMissing'))
      return
    }
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const resolvedBaseUrl = spec.showBaseUrl
        ? baseUrl.trim() === ''
          ? null
          : baseUrl.trim()
        : spec.baseUrlDefault || null
      const input: AiProviderInput = { kind: spec.kind, model, base_url: resolvedBaseUrl }
      // Send a key only when one was typed (and the provider takes one); blank keeps the
      // stored key.
      if (spec.key !== 'none' && apiKey !== '') {
        input.api_key = apiKey
      }
      const result = await saveAiProvider(input)
      // Remember the choice, so the form and the navigator both name the provider the way
      // the user picked it — a saved config alone cannot always tell the presets apart.
      saveProviderPreset(preset)
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
    try {
      await clearAiProvider()
      setProvider(null)
      seedFields(preset, null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }

  const keyPlaceholder = keyStored
    ? ''
    : spec.key === 'required'
      ? t('settings.aiApiKeyEnter')
      : t('settings.aiApiKeyOptionalPlaceholder')
  const keyHint = keyStored ? t('settings.aiApiKeySaved') : t('settings.aiApiKeyHint')

  return (
    <Section title={t('settings.ai')}>
      <p className="-mt-1 text-xs text-muted-foreground">{t('settings.aiHint')}</p>

      <Field label={t('settings.aiProviderLabel')}>
        <select
          value={preset}
          onChange={(event) => selectPreset(event.target.value as ProviderPreset)}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {AI_PRESET_ORDER.map((option) => (
            <option key={option} value={option}>
              {t(AI_PRESETS[option].labelKey)}
            </option>
          ))}
        </select>
      </Field>

      {spec.showBaseUrl ? (
        <Field label={t('settings.aiBaseUrl')} hint={t('settings.aiBaseUrlHint')}>
          <Input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={spec.baseUrlDefault || 'https://…'}
          />
        </Field>
      ) : null}

      <Field label={t('settings.aiModel')}>
        <Input
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder={spec.modelPlaceholder}
        />
      </Field>

      {spec.key !== 'none' ? (
        <Field label={t('settings.aiApiKey')} hint={keyHint}>
          <Input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={keyPlaceholder}
            autoComplete="off"
          />
        </Field>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex items-center gap-2">
        <Button variant="brand" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? t('settings.aiSaving') : t('settings.aiSave')}
        </Button>
        {configured ? (
          <Button variant="ghost" size="sm" onClick={handleRemove} disabled={saving}>
            {t('settings.aiRemove')}
          </Button>
        ) : null}
        {saved ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Check className="size-3.5" />
            {t('settings.aiSaved')}
          </span>
        ) : null}
      </div>

      {/* Approved destinations: the remote endpoints the user has agreed to send the schema
          to, each revocable here — the configurable side of the navigator's one-time consent. */}
      <div className="mt-1 border-t border-border/60 pt-4">
        <p className="text-sm">{t('settings.aiApproved')}</p>
        <p className="text-xs text-muted-foreground">{t('settings.aiApprovedHint')}</p>
        {approved.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">{t('settings.aiApprovedEmpty')}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {approved.map((id) => (
              <li
                key={id}
                className="flex items-center justify-between gap-2 rounded-md border bg-background px-2.5 py-1.5"
              >
                <span className="min-w-0 truncate text-sm" title={labelForDestinationId(id)}>
                  {labelForDestinationId(id)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-xs"
                  onClick={() => onRevoke(id)}
                >
                  {t('settings.aiRevoke')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  )
}

// The dialog's left-hand navigation: one entry per settings group, shown one at a time so
// the panel stays short rather than one long scroll.
const SETTINGS_CATEGORIES = [
  { id: 'appearance', labelKey: 'settings.appearance', icon: Palette },
  { id: 'erMap', labelKey: 'settings.erMap', icon: Network },
  { id: 'ai', labelKey: 'settings.ai', icon: Sparkles },
  { id: 'about', labelKey: 'settings.about', icon: Info },
] as const

type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number]['id']

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  /** Which group to open on; defaults to the first. Lets a caller point at its own setting. */
  initialCategory?: SettingsCategory
  /** Destinations the user has agreed the navigator may send the schema to. */
  approved: string[]
  /** Revoke an approved destination by its identifier. */
  onRevoke: (id: string) => void
}

/**
 * The settings modal: appearance (theme), ER map defaults, the AI navigator provider and
 * approved destinations, and an About section. Opened from the top bar's gear. A light
 * overlay; Escape or a click outside closes it.
 */
export function SettingsDialog({
  open,
  onClose,
  approved,
  onRevoke,
  initialCategory,
}: SettingsDialogProps) {
  const { t } = useTranslation()
  const { settings, update } = useSettings()
  const [version, setVersion] = useState<string | null>(null)
  const [category, setCategory] = useState<SettingsCategory>('appearance')
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

  // Open on the group the caller asked for, so arriving from a setting's own control lands
  // on it rather than making the user hunt for it.
  useEffect(() => {
    if (open) {
      setCategory(initialCategory ?? 'appearance')
    }
  }, [open, initialCategory])

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
        className="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border bg-card shadow-lg outline-none"
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

        <div className="flex min-h-0 flex-1">
          {/* Left-hand group navigation: click a group to show only its settings. */}
          <nav
            aria-label={t('settings.title')}
            className="flex w-44 shrink-0 flex-col gap-0.5 overflow-y-auto border-r p-2"
          >
            {SETTINGS_CATEGORIES.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setCategory(item.id)}
                  aria-current={category === item.id ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                    category === item.id
                      ? 'bg-brand/10 font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  {t(item.labelKey)}
                </button>
              )
            })}
          </nav>

          <div className="min-h-[20rem] min-w-0 flex-1 overflow-y-auto">
            {category === 'appearance' ? (
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
            ) : null}

            {category === 'erMap' ? (
              <Section title={t('settings.erMap')}>
                <Row
                  label={t('settings.showViewDependencies')}
                  hint={t('settings.showViewDependenciesHint')}
                >
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
            ) : null}

            {category === 'ai' ? (
              <AiProviderSection open={open} approved={approved} onRevoke={onRevoke} />
            ) : null}

            {category === 'about' ? (
              <Section title={t('settings.about')}>
                <Row label={t('settings.version')}>
                  <span className="text-sm text-muted-foreground">{version ?? '—'}</span>
                </Row>
              </Section>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
