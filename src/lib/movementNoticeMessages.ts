// The three fixed WhatsApp notices exchanged between the workshop and the site
// foremen (migration 0110). Pure: no I/O, so the texts are unit-tested.
//
// The texts are server-side templates. A client never supplies message text;
// only facts resolved by the database are interpolated. Each message is
// BILINGUAL, Arabic paragraph first and English second, because some foremen
// do not read Arabic. Arabic copy uses the plain alif only (project rule).

export const MOVEMENT_NOTICE_KINDS = [
  'workshop_arrival',
  'site_exit',
  'workshop_exit',
] as const

export type MovementNoticeKind = (typeof MOVEMENT_NOTICE_KINDS)[number]

export interface MovementNoticeFacts {
  equipmentCode: string | null | undefined
  equipmentType?: string | null
  projectNameAr?: string | null
  projectNameEn?: string | null
  companyNameAr?: string | null
  companyNameEn?: string | null
  senderName?: string | null
}

const FIELD_MAX_LENGTH = 80

export function isMovementNoticeKind(
  value: unknown,
): value is MovementNoticeKind {
  return (
    typeof value === 'string' &&
    (MOVEMENT_NOTICE_KINDS as readonly string[]).includes(value)
  )
}

// One line, bounded length: a stored name can never break the layout of the
// message or push it past the gateway limit.
function clean(value: string | null | undefined): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, FIELD_MAX_LENGTH)
}

function firstOf(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const text = clean(value)
    if (text) return text
  }
  return ''
}

// "CODE (type)", or the code alone when the type is unknown.
function unit(facts: MovementNoticeFacts): string {
  const code = clean(facts.equipmentCode) || '-'
  const type = clean(facts.equipmentType)
  return type ? `${code} (${type})` : code
}

// " (project - company)" in the preferred language, or nothing.
function place(facts: MovementNoticeFacts, language: 'ar' | 'en'): string {
  const project =
    language === 'ar'
      ? firstOf(facts.projectNameAr, facts.projectNameEn)
      : firstOf(facts.projectNameEn, facts.projectNameAr)
  const company =
    language === 'ar'
      ? firstOf(facts.companyNameAr, facts.companyNameEn)
      : firstOf(facts.companyNameEn, facts.companyNameAr)
  const parts = [project, company].filter(Boolean)
  return parts.length ? ` (${parts.join(' - ')})` : ''
}

// The sender's name is the one value a user can edit himself (`full_name`),
// so only letters, spaces, apostrophes and hyphens survive: no digits, dots or
// slashes, which keeps a link or a phone number out of a message the company
// number sends.
function signature(facts: MovementNoticeFacts): string {
  const sender = clean(facts.senderName)
    .replace(/[^\p{L}\p{M} '-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
  return sender ? ` — ${sender}` : ''
}

export function movementNoticeMessage(
  kind: MovementNoticeKind,
  facts: MovementNoticeFacts,
): string {
  const name = unit(facts)
  switch (kind) {
    case 'workshop_arrival':
      return [
        `المعدة ${name} وصلت الورشة وهي ما زالت مسجلة داخل موقعك${place(facts, 'ar')}. الرجاء تسجيل خروجها من الموقع.${signature(facts)}`,
        `Equipment ${name} has arrived at the workshop but is still recorded inside your site${place(facts, 'en')}. Please record its site exit.${signature(facts)}`,
      ].join('\n\n')
    case 'site_exit':
      return [
        `تم تسجيل خروج المعدة ${name} من الموقع. يمكنك الان تسجيل دخولها للورشة.`,
        `The site exit of equipment ${name} has been recorded. You can now record its workshop entry.`,
      ].join('\n\n')
    case 'workshop_exit':
      return [
        `المعدة ${name} خرجت من الورشة. اذا عادت لموقعك الرجاء تسجيل دخولها.`,
        `Equipment ${name} has left the workshop. If it returns to your site, please record its entry.`,
      ].join('\n\n')
  }
}
