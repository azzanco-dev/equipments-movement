import { useEffect, useRef, useState, type ClipboardEvent } from 'react'
import { useI18n } from '@/i18n/I18nContext'
import { cn } from '@/components/ui'
import {
  SHORT_ADDRESS_DIGITS,
  SHORT_ADDRESS_LETTERS,
  normalizeShortAddress,
  splitShortAddress,
} from '@/lib/partyFields'

export interface ShortAddressInputProps {
  value: string
  onChange: (value: string) => void
  /** Set by `Field`; goes on the letters cell so the label focuses it. */
  id?: string
  /** Marks the field invalid; `Field` sets it automatically. */
  invalid?: boolean
  'aria-describedby'?: string
}

/**
 * The short national address (migration 0179, owner 2026-11-05: «حقل يكون
 * مقسم»): one field split in two cells, read left to right like the code
 * itself — 4 Latin letters, then 4 digits («RRRD | 2929»). The letters are
 * upper-cased and anything else is dropped; a full letters cell moves the
 * cursor to the digits, Backspace in an empty digits cell goes back, and a
 * pasted whole code («RRRD2929», «rrrd-2929») fills both cells. The value
 * sent up is the joined code, as the trigger stores it.
 */
export function ShortAddressInput({
  value,
  onChange,
  id,
  invalid,
  'aria-describedby': describedBy,
}: ShortAddressInputProps) {
  const { t } = useI18n()
  const [parts, setParts] = useState(() => splitShortAddress(value))
  const lettersRef = useRef<HTMLInputElement>(null)
  const digitsRef = useRef<HTMLInputElement>(null)

  // A value set from outside (the dialog opening on a record) refills the
  // cells; typing keeps them as they are.
  useEffect(() => {
    if (normalizeShortAddress(value) !== parts.letters + parts.digits)
      setParts(splitShortAddress(value))
  }, [value, parts])

  const update = (next: { letters: string; digits: string }) => {
    setParts(next)
    onChange(next.letters + next.digits)
  }

  const onLetters = (raw: string) => {
    const letters = raw
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, SHORT_ADDRESS_LETTERS)
    update({ ...parts, letters })
    if (letters.length === SHORT_ADDRESS_LETTERS && !parts.digits)
      digitsRef.current?.focus()
  }

  const onDigits = (raw: string) => {
    const digits = splitShortAddress(
      `AAAA${raw.replace(/[A-Za-z]/g, '')}`,
    ).digits
    update({ ...parts, digits })
  }

  /** A whole code pasted into either cell fills both. */
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text')
    const whole = splitShortAddress(text)
    if (!whole.letters || !whole.digits) return
    event.preventDefault()
    update(whole)
    digitsRef.current?.focus()
  }

  const cell =
    'h-10 w-full min-w-0 bg-transparent px-3 text-center text-base tabular-nums outline-none [font-family:var(--font-field)] placeholder:text-placeholder md:h-9 md:text-sm'

  return (
    <div
      dir="ltr"
      role="group"
      aria-label={t('shortAddress')}
      aria-invalid={invalid || undefined}
      className={cn(
        // The look of the shared `.input`: token border, primary focus ring.
        'flex items-stretch overflow-hidden rounded-lg border border-[var(--border)] bg-transparent transition-colors focus-within:border-[var(--primary)] focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--primary)_16%,transparent)]',
        invalid && '!border-[var(--danger)]',
      )}
    >
      <input
        ref={lettersRef}
        id={id}
        aria-label={t('shortAddressLetters')}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        inputMode="text"
        maxLength={SHORT_ADDRESS_LETTERS}
        placeholder="RRRD"
        value={parts.letters}
        onChange={(event) => onLetters(event.target.value)}
        onPaste={onPaste}
        className={cell}
      />
      <span aria-hidden="true" className="w-px shrink-0 bg-[var(--border)]" />
      <input
        ref={digitsRef}
        aria-label={t('shortAddressDigits')}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        inputMode="numeric"
        maxLength={SHORT_ADDRESS_DIGITS}
        placeholder="2929"
        value={parts.digits}
        onChange={(event) => onDigits(event.target.value)}
        onPaste={onPaste}
        onKeyDown={(event) => {
          if (event.key === 'Backspace' && !parts.digits)
            lettersRef.current?.focus()
        }}
        className={cell}
      />
    </div>
  )
}
