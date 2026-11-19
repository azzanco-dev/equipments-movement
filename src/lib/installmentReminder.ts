// The daily WhatsApp reminder of installment due dates (migration 0205).
// Pure: no I/O, no imports. The server route reads
// `prepare_installment_reminder`, parses it with `parseInstallmentReminder`
// and sends the text of `buildInstallmentReminderMessage`.
//
// The text is a fixed template (owner 2026-11-18 / 2026-11-19):
//
//   تذكير الاقساط - 19/11/2026
//
//   متاخرة (1):
//   • INS-0003 - شراء شيول - بنك الراجحي - 12,500 ريال - متاخر 3 ايام
//
//   مستحقة اليوم (1):
//   • …
//
//   بعد 7 ايام (2):
//   • …
//
//   الرابط: https://portal.azzanco.com/installments
//
// A section with nothing is left out; with nothing at all there is no
// message (`null`). One line per CONTRACT in a section: its unpaid rows of
// that section are added up (overdue: the days of the oldest one). Digits are
// Latin, amounts carry thousands separators and their halalas only when they
// are not zero. A long section is cut with «و N اخرى». The template words
// carry no alif with hamza or madda; the contract titles and financier names
// are data and are printed as stored, on one line.

export type InstallmentReminderBucket = 'overdue' | 'today' | 'soon'

export interface InstallmentReminderItem {
  bucket: InstallmentReminderBucket
  contractNumber: string
  description: string
  financierName: string
  seq: number
  /** YYYY-MM-DD */
  dueDate: string
  remainingAmount: number
  /** Negative = days overdue. */
  daysUntilDue: number
}

export interface InstallmentReminderRecipient {
  logId: string
  name: string
  mobile: string | null
}

export interface InstallmentReminderPayload {
  /** The Saudi day, YYYY-MM-DD. */
  day: string
  items: InstallmentReminderItem[]
  recipients: InstallmentReminderRecipient[]
  skipped: number
}

const BUCKETS: readonly InstallmentReminderBucket[] = ['overdue', 'today', 'soon']

export const INSTALLMENT_REMINDER_TITLE = 'تذكير الاقساط'
export const INSTALLMENT_REMINDER_SECTION_TITLES: Record<
  InstallmentReminderBucket,
  string
> = {
  overdue: 'متاخرة',
  today: 'مستحقة اليوم',
  soon: 'بعد 7 ايام',
}
export const INSTALLMENT_REMINDER_LINK_LABEL = 'الرابط'
export const INSTALLMENT_REMINDER_CURRENCY = 'ريال'
export const INSTALLMENT_REMINDER_PATH = '/installments'

/** Lines shown per section before «و N اخرى». */
export const INSTALLMENT_REMINDER_MAX_LINES = 8
/** Kept under the gateway's 4096 characters with room to spare. */
export const INSTALLMENT_REMINDER_MAX_LENGTH = 3500
const MAX_TITLE_LENGTH = 60
const MAX_NAME_LENGTH = 40

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// --- parsing ------------------------------------------------------------------

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
}

function isBucket(value: unknown): value is InstallmentReminderBucket {
  return (
    typeof value === 'string' &&
    (BUCKETS as readonly string[]).includes(value)
  )
}

/** Reads the JSON of `prepare_installment_reminder`; `null` when malformed. */
export function parseInstallmentReminder(
  data: unknown,
): InstallmentReminderPayload | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return null
  }
  const record = data as Record<string, unknown>
  const day = text(record.day)
  if (!DAY_PATTERN.test(day)) return null

  const items: InstallmentReminderItem[] = []
  for (const raw of Array.isArray(record.items) ? record.items : []) {
    if (typeof raw !== 'object' || raw === null) continue
    const row = raw as Record<string, unknown>
    const remaining = finiteNumber(row.remaining_amount)
    const days = finiteNumber(row.days_until_due)
    const seq = finiteNumber(row.seq)
    const dueDate = text(row.due_date)
    const contractNumber = text(row.contract_number)
    if (
      !isBucket(row.bucket) ||
      !contractNumber ||
      remaining === null ||
      days === null ||
      !DAY_PATTERN.test(dueDate)
    ) {
      continue
    }
    items.push({
      bucket: row.bucket,
      contractNumber,
      description: text(row.description),
      financierName: text(row.financier_name),
      seq: seq ?? 0,
      dueDate,
      remainingAmount: remaining,
      daysUntilDue: Math.trunc(days),
    })
  }

  const recipients: InstallmentReminderRecipient[] = []
  for (const raw of Array.isArray(record.recipients) ? record.recipients : []) {
    if (typeof raw !== 'object' || raw === null) continue
    const row = raw as Record<string, unknown>
    const logId = text(row.log_id)
    if (!logId) continue
    const mobile = text(row.mobile).trim()
    recipients.push({ logId, name: text(row.name), mobile: mobile || null })
  }

  const skipped = finiteNumber(record.skipped)
  return {
    day,
    items,
    recipients,
    skipped: skipped !== null && skipped > 0 ? Math.trunc(skipped) : 0,
  }
}

// --- formatting ---------------------------------------------------------------

/** 19/11/2026 from 2026-11-19. */
export function reminderDayLabel(day: string): string {
  const [year, month, date] = day.split('-')
  return `${date}/${month}/${year}`
}

/** 12,500 · 12,500.50 · Latin digits. */
export function reminderAmountLabel(amount: number): string {
  const halalas = Math.round(Math.abs(amount) * 100)
  const whole = Math.floor(halalas / 100)
  const fraction = halalas % 100
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const sign = amount < 0 && halalas > 0 ? '-' : ''
  return fraction === 0
    ? `${sign}${grouped}`
    : `${sign}${grouped}.${String(fraction).padStart(2, '0')}`
}

/** يوم · يومين · 3 ايام · 11 يوم — the words of the installments screens. */
export function reminderDaysWords(days: number): string {
  if (days === 1) return 'يوم'
  if (days === 2) return 'يومين'
  if (days >= 3 && days <= 10) return `${days} ايام`
  return `${days} يوم`
}

/** قسطين · 3 اقساط · 11 قسط (only said for more than one). */
export function reminderInstallmentsWords(count: number): string {
  if (count === 2) return 'قسطين'
  if (count >= 3 && count <= 10) return `${count} اقساط`
  return `${count} قسط`
}

/** One line of data: no line breaks, no runs of spaces, cut with «…». */
function oneLine(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean
}

export interface InstallmentReminderLine {
  contractNumber: string
  description: string
  financierName: string
  amount: number
  installments: number
  /** For an overdue line: the days of its oldest unpaid row. */
  overdueDays: number
}

/** The lines of one section: one per contract, in the order of the items. */
export function reminderSectionLines(
  items: readonly InstallmentReminderItem[],
  bucket: InstallmentReminderBucket,
): InstallmentReminderLine[] {
  const byContract = new Map<string, InstallmentReminderLine>()
  for (const item of items) {
    if (item.bucket !== bucket) continue
    const line = byContract.get(item.contractNumber)
    if (line) {
      line.amount += item.remainingAmount
      line.installments += 1
      line.overdueDays = Math.max(line.overdueDays, -item.daysUntilDue)
    } else {
      byContract.set(item.contractNumber, {
        contractNumber: item.contractNumber,
        description: item.description,
        financierName: item.financierName,
        amount: item.remainingAmount,
        installments: 1,
        overdueDays: Math.max(0, -item.daysUntilDue),
      })
    }
  }
  const lines = [...byContract.values()]
  // The most overdue first; the item order (due date) otherwise.
  if (bucket === 'overdue') {
    lines.sort((a, b) => b.overdueDays - a.overdueDays)
  }
  return lines
}

function lineText(
  line: InstallmentReminderLine,
  bucket: InstallmentReminderBucket,
): string {
  const parts = [line.contractNumber]
  const title = oneLine(line.description, MAX_TITLE_LENGTH)
  if (title) parts.push(title)
  const financier = oneLine(line.financierName, MAX_NAME_LENGTH)
  if (financier) parts.push(financier)
  parts.push(
    `${reminderAmountLabel(line.amount)} ${INSTALLMENT_REMINDER_CURRENCY}`,
  )
  if (line.installments > 1) {
    parts.push(reminderInstallmentsWords(line.installments))
  }
  if (bucket === 'overdue') {
    parts.push(`متاخر ${reminderDaysWords(line.overdueDays)}`)
  }
  return `• ${parts.join(' - ')}`
}

/** «و 3 اخرى» */
export function reminderMoreLabel(count: number): string {
  return `و ${count} اخرى`
}

/** `https://portal.azzanco.com/installments`, or `null` without an origin. */
export function reminderLink(appBaseUrl: string | null | undefined): string | null {
  if (typeof appBaseUrl !== 'string') return null
  const origin = appBaseUrl.trim().replace(/\/+$/, '')
  return origin ? `${origin}${INSTALLMENT_REMINDER_PATH}` : null
}

function compose(
  day: string,
  items: readonly InstallmentReminderItem[],
  link: string | null,
  maxLines: number,
): string | null {
  const blocks: string[] = []
  for (const bucket of BUCKETS) {
    const lines = reminderSectionLines(items, bucket)
    if (lines.length === 0) continue
    const shown = lines.slice(0, maxLines).map((line) => lineText(line, bucket))
    if (lines.length > maxLines) {
      shown.push(reminderMoreLabel(lines.length - maxLines))
    }
    blocks.push(
      [
        `${INSTALLMENT_REMINDER_SECTION_TITLES[bucket]} (${lines.length}):`,
        ...shown,
      ].join('\n'),
    )
  }
  if (blocks.length === 0) return null
  const parts = [
    `${INSTALLMENT_REMINDER_TITLE} - ${reminderDayLabel(day)}`,
    ...blocks,
  ]
  if (link) parts.push(`${INSTALLMENT_REMINDER_LINK_LABEL}: ${link}`)
  return parts.join('\n\n')
}

/**
 * The reminder text of one day, or `null` when there is nothing to say.
 * Shortens the sections (down to one line each) when the text would pass
 * `INSTALLMENT_REMINDER_MAX_LENGTH`.
 */
export function buildInstallmentReminderMessage(input: {
  day: string
  items: readonly InstallmentReminderItem[]
  appBaseUrl?: string | null
  maxLines?: number
}): string | null {
  const link = reminderLink(input.appBaseUrl)
  let maxLines = Math.max(1, input.maxLines ?? INSTALLMENT_REMINDER_MAX_LINES)
  let message = compose(input.day, input.items, link, maxLines)
  while (
    message !== null &&
    message.length > INSTALLMENT_REMINDER_MAX_LENGTH &&
    maxLines > 1
  ) {
    maxLines -= 1
    message = compose(input.day, input.items, link, maxLines)
  }
  return message
}
