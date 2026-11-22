import { useEffect, useMemo, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { AsyncSearchSelect } from '@/components/AsyncSearchSelect'
import { BankLogo } from '@/components/banks/BankLogo'
import { Field, IconButton, Input } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { loadInstallmentBankOptions } from '@/lib/installmentsData'
import type { InstallmentAccount } from '@/lib/installmentsView'
import { formatIban, normalizeIban, SAUDI_IBAN_LENGTH } from '@/lib/partyFields'
import { OptionalLabel } from './cells'

/**
 * The bank and the IBAN of an installments account (0208), as the supplier
 * form has them: the bank picked from the banks list (0177) with its logo,
 * the IBAN typed with or without spaces (stored without, upper-case). Both
 * optional. Used by the financier dialog and, for a contract's own account,
 * by the contract dialog.
 */
export function BankAccountFields({
  bankName,
  iban,
  onBankName,
  onIban,
  bankError,
  ibanError,
  ibanHint,
  stacked = false,
}: {
  bankName: string
  iban: string
  onBankName: (value: string) => void
  onIban: (value: string) => void
  bankError?: TranslationKey | null
  ibanError?: TranslationKey | null
  ibanHint?: string
  /** One field a row: the IBAN under the bank on its own line (the
   *  financier dialog, Figma 2026-11-22: 24 characters with their spaces do
   *  not fit half a 512 px dialog). */
  stacked?: boolean
}) {
  const { t } = useI18n()
  const loadBanks = useMemo(
    () => async (query: string) =>
      (await loadInstallmentBankOptions(query)).map((option) => ({
        ...option,
        icon: <BankLogo name={option.value} size="sm" />,
      })),
    [],
  )
  return (
    <div className={stacked ? 'grid gap-3' : 'grid gap-4 sm:grid-cols-2'}>
      <Field
        name="bank_name"
        label={<OptionalLabel text={t('bankName')} />}
        error={bankError ? t(bankError) : undefined}
      >
        {(control) => (
          <AsyncSearchSelect
            {...control}
            size="md"
            value={bankName}
            selectedOption={
              bankName
                ? {
                    value: bankName,
                    label: bankName,
                    icon: <BankLogo name={bankName} size="sm" />,
                  }
                : null
            }
            onChange={(value) => onBankName(value)}
            loadOptions={loadBanks}
            placeholder={t('bankNamePlaceholder')}
          />
        )}
      </Field>
      <Field
        name="iban"
        label={<OptionalLabel text={t('iban')} />}
        error={ibanError ? t(ibanError) : undefined}
        hint={ibanHint}
      >
        {(control) => (
          <Input
            {...control}
            dir="ltr"
            inputMode="text"
            autoComplete="off"
            // Room for the spaces a pasted IBAN carries.
            maxLength={SAUDI_IBAN_LENGTH + 10}
            placeholder={t('ibanPlaceholder')}
            value={iban}
            onChange={(event) => onIban(event.target.value)}
          />
        )}
      </Field>
    </div>
  )
}

/**
 * The account a contract is paid to (0208): the bank with its logo, the
 * IBAN in groups of four with a copy button, and whose account it is.
 * Nothing recorded = a quiet line.
 */
export function BankAccountLine({
  account,
  showSource = true,
}: {
  account: InstallmentAccount | null
  showSource?: boolean
}) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  if (!account)
    return <span className="text-sm text-muted">{t('instNoAccount')}</span>

  const iban = account.iban ? normalizeIban(account.iban) : null
  const copy = async () => {
    if (!iban) return
    try {
      await navigator.clipboard.writeText(iban)
      setCopied(true)
    } catch {
      // A browser without clipboard access: nothing to report.
    }
  }

  return (
    <span className="flex min-w-0 flex-col gap-1">
      {account.bankName && (
        <span className="flex min-w-0 items-center gap-2">
          <BankLogo name={account.bankName} size="sm" />
          <span className="min-w-0 break-words font-medium">
            {account.bankName}
          </span>
        </span>
      )}
      {iban && (
        <span className="flex items-center gap-1">
          <bdi dir="ltr" className="font-medium tabular-nums">
            {formatIban(iban)}
          </bdi>
          <IconButton
            size="sm"
            label={copied ? t('detailsCopied') : t('detailsCopy')}
            title={copied ? t('detailsCopied') : t('detailsCopy')}
            icon={
              copied ? (
                <Check size={14} className="text-[var(--success)]" />
              ) : (
                <Copy size={14} />
              )
            }
            onClick={copy}
          />
        </span>
      )}
      {showSource && (
        <span className="text-xs text-muted">
          {t(account.own ? 'instAccountOwn' : 'instAccountFinancier')}
        </span>
      )}
    </span>
  )
}
