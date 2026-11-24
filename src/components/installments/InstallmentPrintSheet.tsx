import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Price } from '@/components/purchasing/Price'
import { translations, type TranslationKey } from '@/i18n/translations'
import { bankInitials, bankLogoOf } from '@/lib/bankLogos'
import { COMPANY_PROFILE } from '@/lib/companyProfile'
import { formatDate } from '@/lib/dateFormat'
import { daysUntilDue, formatInstallmentAmount } from '@/lib/installments'
import {
  INSTALLMENT_PRINT_STATE_KEYS,
  installmentPrintFileName,
  installmentPrintGroups,
  installmentPrintState,
  type InstallmentPrintState,
} from '@/lib/installmentPrint'
import {
  amountOf,
  installmentsWords,
  isSchedulePaid,
  payableRowLabel,
  scheduleRemaining,
  whenWords,
  type InstallmentAccount,
  type InstallmentContractRow,
  type InstallmentScheduleItem,
} from '@/lib/installmentsView'
import { formatIban, normalizeIban } from '@/lib/partyFields'
import { printIssuedAtLabel, quotationPageCss } from '@/lib/quotationPrint'
import { saudiDateKey } from '@/lib/saudiTime'

/** If the browser never reports the dialog closed, the sheet leaves anyway. */
const AFTERPRINT_FALLBACK_MS = 120_000

/** The sheet is Arabic only (owner: an internal sheet for accounting). */
const ar = (key: TranslationKey) => translations.ar[key]

const BRAND = 'text-[var(--brand-charcoal)]'
const CELL = 'border px-1.5 py-[2px] align-middle'
const HEAD = `${CELL} border-[var(--brand-charcoal)] bg-[var(--brand-charcoal)] font-medium text-bg`
const TABLE =
  'w-full table-fixed border-collapse border-t-[3px] border-t-[var(--brand-amber)]'
const SECTION_TITLE = `mb-1 font-medium ${BRAND}`
const AMBER_TINT = 'bg-[color-mix(in_srgb,var(--brand-amber)_16%,transparent)]'

const STATE_INK: Readonly<Record<InstallmentPrintState, string>> = {
  paid: 'font-medium text-success',
  asked: `font-bold ${BRAND}`,
  late: 'font-medium text-danger',
  partial: 'font-medium text-info',
  waits: 'text-warning',
  upcoming: 'text-muted',
}

function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex gap-1.5">
      <dt className="shrink-0 text-muted">{label}:</dt>
      <dd className="m-0 font-medium">{children}</dd>
    </div>
  )
}

/** An amount with the riyal sign at its left, as the quotation sheet. */
function Amount({ value }: { value: number | string | null }) {
  return (
    <span dir="rtl" className="inline-block whitespace-nowrap">
      <Price value={value} />
    </span>
  )
}

export interface InstallmentPrintSheetProps {
  contract: InstallmentContractRow
  schedule: readonly InstallmentScheduleItem[]
  /** The row to pay: the contract's next due row. */
  asked: InstallmentScheduleItem
  /** The account it is paid to (the contract's own, else the financier's). */
  account: InstallmentAccount | null
  /** The print dialog closed (or never opened): the sheet is unmounted. */
  onDone: () => void
}

/**
 * «تصدير القسط» of the contract page: the PDF «سداد قسط» for accounting
 * (owner 2026-11-24, model 1 approved in Figma, «نموذج 1، اعتمد وابني»).
 * It prints straight from the contract page the way the quotation sheet
 * does — portaled to `document.body` only while printing, hidden on screen
 * and the ONLY thing printed (`src/index.css`, «installment print sheet»;
 * `print-export` forces the light tokens), unmounted on `afterprint`.
 * Nothing is fetched or stored.
 *
 * Arabic only, A4 wide, in the company's brand colours: the logo and the
 * title «سداد قسط» (no company data); one line with the contract's title
 * (which carries the financier's own number), the financier and the day
 * of the request (no internal number); the amber box of the installment to
 * pay — its name, its day and how far it is, the amount still due on it;
 * the whole schedule in five columns (# · الدفعة · تاريخ الاستحقاق · المبلغ
 * · الحالة), the asked row tinted, group rows by title only; the contract's
 * total, paid and remaining once, under the table; then «حساب السداد» with
 * the bank's logo, its name and the IBAN; the electronic-issue line. Every
 * page carries its number and the issue time (`quotationPageCss`).
 */
export function InstallmentPrintSheet({
  contract,
  schedule,
  asked,
  account,
  onDone,
}: InstallmentPrintSheetProps) {
  const logoRef = useRef<HTMLImageElement>(null)
  const [logoSettled, setLogoSettled] = useState(false)
  const printed = useRef(false)
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  const [issuedAt] = useState(() => printIssuedAtLabel(new Date()))
  const [today] = useState(() => saudiDateKey())
  const title = ar('instPrintTitle')
  const fileName = installmentPrintFileName(title, contract.description)

  useEffect(() => {
    // Once per mount: the ref survives React's development double-mount.
    if (printed.current) return
    if (!logoSettled && !logoRef.current?.complete) return
    printed.current = true
    const previousTitle = document.title
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      window.removeEventListener('afterprint', finish)
      window.clearTimeout(fallback)
      document.title = previousTitle
      doneRef.current()
    }
    const fallback = window.setTimeout(finish, AFTERPRINT_FALLBACK_MS)
    window.addEventListener('afterprint', finish)
    // The suggested PDF file name.
    document.title = fileName
    const fontsReady =
      typeof document.fonts?.ready?.then === 'function'
        ? document.fonts.ready
        : Promise.resolve()
    void fontsReady.then(() =>
      window.requestAnimationFrame(() => window.print()),
    )
    // No cleanup on purpose (the quotation sheet's reason): once the print
    // started, the listener and the fallback belong to it.
  }, [logoSettled, fileName])

  const groups = installmentPrintGroups(contract, schedule)
  const days = asked.due_date ? daysUntilDue(asked.due_date, today) : null
  const askedTitle =
    asked.kind === 'installment'
      ? payableRowLabel(asked, ar, contract.installment_count)
      : payableRowLabel(asked, ar)
  const partial = amountOf(asked.paid_amount) > 0 && !isSchedulePaid(asked)
  const iban = account?.iban ? formatIban(normalizeIban(account.iban)) : null
  const logo = bankLogoOf(account?.bankName)
  const rowTitle = (row: InstallmentScheduleItem) =>
    row.kind === 'installment'
      ? ar('instInstallmentN').replace('{seq}', String(row.seq)) +
        (row.note?.trim() ? ` - ${row.note.trim()}` : '')
      : payableRowLabel(row, ar)

  return createPortal(
    <div
      className="installment-print-sheet print-export hidden bg-bg text-fg [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
      dir="rtl"
      lang="ar"
      aria-hidden="true"
    >
      <style>{quotationPageCss(issuedAt, 'ar')}</style>
      <div className="mx-auto max-w-[210mm] px-[10mm] pb-[2mm] pt-[8mm] text-[11px] leading-[15px] [-webkit-box-decoration-break:clone] [box-decoration-break:clone]">
        {/* 1. The title and the logo; no company data. */}
        <header className="mb-[10px] flex items-start justify-between gap-4">
          <div className="flex flex-col items-start">
            <h1 className={`text-[24px] font-bold leading-[30px] ${BRAND}`}>
              {title}
            </h1>
            <span
              aria-hidden="true"
              className="my-1 block h-1 w-12 rounded-sm bg-[var(--brand-amber)]"
            />
          </div>
          <img
            ref={logoRef}
            onLoad={() => setLogoSettled(true)}
            onError={() => setLogoSettled(true)}
            src="/azzanco-logo-full.png"
            alt=""
            className="h-[13mm] w-auto object-contain"
          />
        </header>

        {/* 2. The contract on one line. */}
        <dl className="m-0 mb-[10px] flex flex-wrap gap-x-6 gap-y-0.5 text-[10px] leading-[14px]">
          <Fact label={ar('instPrintContractTitle')}>{contract.description}</Fact>
          <Fact label={ar('instFinancier')}>{contract.financier_name}</Fact>
          <Fact label={ar('instPrintRequestDate')}>
            <bdi dir="ltr">{formatDate(today)}</bdi>
          </Fact>
        </dl>

        {/* 3. The installment to pay. */}
        <section
          className={`mb-[12px] flex break-inside-avoid items-center justify-between gap-6 rounded-md border-[1.5px] border-[var(--brand-amber)] px-3 py-2.5 ${AMBER_TINT}`}
        >
          <div className="min-w-0 space-y-1">
            <p className="flex items-center gap-1.5 text-[10px] font-medium text-muted">
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-1 rounded-sm bg-[var(--brand-amber)]"
              />
              {ar('instPrintAsked')}
            </p>
            <p className={`break-words text-[14px] font-bold leading-[19px] ${BRAND}`}>
              {askedTitle}
            </p>
            <dl className="m-0 flex flex-wrap gap-x-5 text-[10px]">
              <Fact label={ar('instDueDate')}>
                {asked.due_date ? (
                  <bdi dir="ltr">{formatDate(asked.due_date)}</bdi>
                ) : (
                  ar('instFpWaitsDate')
                )}
              </Fact>
              {days !== null && (
                <div
                  className={
                    days < 0 ? 'font-medium text-danger' : 'font-medium'
                  }
                >
                  {whenWords(days, 'ar')}
                </div>
              )}
            </dl>
          </div>
          <div className="shrink-0 text-end">
            <p className="text-[10px] text-muted">
              {ar('instPrintAskedAmount')}
            </p>
            <p className="text-[20px] font-bold leading-[26px]">
              <Amount value={scheduleRemaining(asked)} />
            </p>
            {partial && (
              <p className="text-[10px] text-muted">
                {ar('instPrintOfTotal').replace(
                  '{amount}',
                  formatInstallmentAmount(asked.amount),
                )}
              </p>
            )}
          </div>
        </section>

        {/* 4. The whole schedule. */}
        <section className="mb-[10px]">
          <h2 className={SECTION_TITLE}>{ar('instPayTableTitle')}</h2>
          <table className={`${TABLE} text-[10px] leading-[13px]`}>
            <colgroup>
              <col style={{ width: '6%' }} />
              <col />
              <col style={{ width: '17%' }} />
              <col style={{ width: '19%' }} />
              <col style={{ width: '13%' }} />
            </colgroup>
            <thead className="[display:table-header-group]">
              <tr>
                <th scope="col" className={`${HEAD} text-start`}>
                  #
                </th>
                <th scope="col" className={`${HEAD} text-start`}>
                  {ar('instColPayment')}
                </th>
                <th scope="col" className={`${HEAD} text-start`}>
                  {ar('instDueDate')}
                </th>
                <th scope="col" className={`${HEAD} text-start`}>
                  {ar('instAmount')}
                </th>
                <th scope="col" className={`${HEAD} text-start`}>
                  {ar('instStatus')}
                </th>
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody key={group.key}>
                <tr className="break-inside-avoid bg-surface-hover">
                  <th
                    scope="colgroup"
                    colSpan={5}
                    className={`${CELL} text-start font-bold`}
                  >
                    {ar(group.title)}
                  </th>
                </tr>
                {group.key === 'installments' && group.rows.length === 0 && (
                  <tr className="break-inside-avoid">
                    <td colSpan={5} className={`${CELL} text-muted`}>
                      {ar('instNotDividedTitle')} ·{' '}
                      {installmentsWords(contract.installment_count, 'ar')}
                    </td>
                  </tr>
                )}
                {group.rows.map((row, index) => {
                  const state = installmentPrintState(row, asked.id, today)
                  const isAsked = state === 'asked'
                  const ink = state === 'paid' ? 'text-muted' : ''
                  return (
                    <tr
                      key={row.id}
                      className={`break-inside-avoid ${
                        isAsked ? AMBER_TINT : index % 2 ? 'bg-surface' : ''
                      }`}
                    >
                      <td className={`${CELL} tabular-nums text-muted`}>
                        {row.seq}
                      </td>
                      <td
                        className={`${CELL} break-words ${
                          isAsked ? 'font-bold' : 'font-medium'
                        } ${ink}`}
                      >
                        {rowTitle(row)}
                      </td>
                      <td
                        className={`${CELL} ${isAsked ? 'font-bold' : ''} ${ink}`}
                      >
                        {row.due_date ? (
                          <bdi dir="ltr">{formatDate(row.due_date)}</bdi>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td
                        className={`${CELL} ${isAsked ? 'font-bold' : ''} ${ink}`}
                      >
                        <Amount value={row.amount} />
                      </td>
                      <td className={`${CELL} ${STATE_INK[state]}`}>
                        {ar(INSTALLMENT_PRINT_STATE_KEYS[state])}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            ))}
          </table>

          {/* The contract's figures, once, under the table. */}
          <dl className="m-0 mt-1.5 inline-flex break-inside-avoid gap-6 rounded-md border px-3 py-1.5">
            {(
              [
                ['instContractTotal', contract.payable_total, ''],
                ['instPaid', contract.paid_overall, 'text-success'],
                ['instRemaining', contract.remaining_total, ''],
              ] as const
            ).map(([key, value, tone]) => (
              <div key={key}>
                <dt className="text-[10px] text-muted">{ar(key)}</dt>
                <dd className={`m-0 text-[12px] font-bold ${tone}`}>
                  <Amount value={value} />
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* 5. The payment account, last, with the bank's logo. */}
        {account && (account.bankName || iban) && (
          <section className="break-inside-avoid">
            <h2 className={SECTION_TITLE}>{ar('instAccountTitle')}</h2>
            <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
              <div className="flex min-w-0 items-center gap-3">
                {account.bankName && (
                  <span
                    className={`flex h-9 w-[88px] shrink-0 items-center justify-center rounded-md border px-2.5 ${
                      logo?.onDark ? 'bg-[var(--logo-tile-dark)]' : 'bg-bg'
                    }`}
                  >
                    {logo ? (
                      <img
                        src={logo.src}
                        alt=""
                        className="max-h-[22px] max-w-full object-contain"
                      />
                    ) : (
                      <span className="font-bold text-muted">
                        {bankInitials(account.bankName)}
                      </span>
                    )}
                  </span>
                )}
                <p className="break-words text-[12px] font-bold">
                  {account.bankName ?? '—'}
                </p>
              </div>
              {iban && (
                <div className="shrink-0 text-end">
                  <p className="text-[10px] text-muted">{ar('instPrintIban')}</p>
                  <p
                    dir="ltr"
                    className="text-[13px] font-bold tabular-nums"
                  >
                    {iban}
                  </p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* 6. The electronic-issue line closes the sheet. */}
        <footer className="mt-[10px] break-inside-avoid border-t pt-1.5 text-[9px] leading-[12px] text-muted">
          <p className="text-start">
            {ar('quotationPrintElectronic').replace(
              '{company}',
              COMPANY_PROFILE.nameAr,
            )}
          </p>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
