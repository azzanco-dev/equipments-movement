// The three fixed WhatsApp notices exchanged between the workshop and the site
// foremen (migration 0110). Pure: no I/O, so the texts are unit-tested.
//
// The texts are server-side templates. A client never supplies message text;
// only facts resolved by the database are interpolated. Each message is
// BILINGUAL: the request line is in Arabic with its English line under it,
// because some foremen do not read Arabic. Arabic copy uses the plain alif only (project rule).

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

// "project - company" in the preferred language, or nothing.
function place(facts: MovementNoticeFacts, language: 'ar' | 'en'): string {
  const project =
    language === 'ar'
      ? firstOf(facts.projectNameAr, facts.projectNameEn)
      : firstOf(facts.projectNameEn, facts.projectNameAr)
  const company =
    language === 'ar'
      ? firstOf(facts.companyNameAr, facts.companyNameEn)
      : firstOf(facts.companyNameEn, facts.companyNameAr)
  return [project, company].filter(Boolean).join(' - ')
}

// The sender's name is the one value a user can edit himself (`full_name`),
// so only letters, spaces, apostrophes and hyphens survive: no digits, dots or
// slashes, which keeps a link or a phone number out of a message the company
// number sends.
function senderName(facts: MovementNoticeFacts): string {
  return clean(facts.senderName)
    .replace(/[^\p{L}\p{M} '-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
}

// One language block: short lines, with a blank line between the facts, the
// request and the sender (owner review 2026-10-01: easier to read on a phone).
function block(...sections: string[][]): string {
  return sections
    .map((lines) => lines.filter(Boolean).join('\n'))
    .filter(Boolean)
    .join('\n\n')
}

export function movementNoticeMessage(
  kind: MovementNoticeKind,
  facts: MovementNoticeFacts,
): string {
  const name = unit(facts)
  const sender = senderName(facts)
  // The facts once (the Arabic names, English as fallback), then the request
  // in Arabic with its English line under it, then the sender. Short lines
  // with a blank line between the sections (owner review 2026-10-01).
  const facts1 = [`🚜 ${name}`]
  switch (kind) {
    case 'workshop_arrival': {
      const where = place(facts, 'ar')
      return block(
        where ? [...facts1, `📍 ${where}`] : facts1,
        [
          '🔧 وصلت الورشة، الرجاء تسجيل خروجها من مشروعك.',
          'Arrived at the workshop. Please record its exit from your project.',
        ],
        [sender ? `👤 ${sender}` : ''],
      )
    }
    case 'site_exit':
      return block(facts1, [
        '✅ خرجت من المشروع، سجل دخولها للورشة.',
        'Project exit recorded. You can record its workshop entry.',
      ])
    case 'workshop_exit':
      return block(facts1, [
        '✅ خرجت من الورشة. اذا عادت لمشروعك سجل دخولها.',
        'Left the workshop. If it returns to your project, record its entry.',
      ])
  }
}
