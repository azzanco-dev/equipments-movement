// The three fixed WhatsApp notices exchanged between the workshop and the site
// foremen (migration 0110). Pure: no I/O, so the texts are unit-tested.
//
// The texts are server-side templates. A client never supplies message text;
// only facts resolved by the database are interpolated. Each message is
// BILINGUAL: the request line is in Arabic with its English line under it,
// because some foremen do not read Arabic. Arabic copy uses the plain alif only (project rule).
//
// The arrival notice also links to the EXIT form with the unit ready (owner
// request 2026-10-15). The link is built here from the server-resolved site
// origin (`appBaseUrl`, APP_BASE_URL only; absent: no link line) and the
// stored code; no user text ever becomes a link.
//
// The equipment code is the one fact a NON-admin can type freely: the workshop
// quick-create accepts any text as the code (security audit 2026-10-18, lead
// D-17, fingerprint em:notice-text:equipment-code-from-workshop-quick-create).
// So in the message BODY the code passes the same kind of allowlist as the
// sender's name: letters, digits, spaces, `_` and `-` only, at most 30
// characters (production codes are at most 8 and use `-` alone), `-` when
// nothing survives. A dot, slash, `@` or `:` can therefore not spell a domain,
// an address or a path in a text the company number sends, and the cap keeps
// a free-text code from carrying a message of its own. The LINK keeps the raw
// code, URL-encoded (`movementExitUrl`), so existing links keep working.

import { movementExitUrl } from '@/lib/movementExitLink'

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
  /** The site origin the arrival notice links to, resolved by the server
   *  (never by a client). Invalid or absent: the message has no link line. */
  appBaseUrl?: string | null
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

const CODE_MAX_LENGTH = 30

// The code as shown in the message body: the allowlist of the file header.
// (The link uses the raw code, see `movementExitUrl`.)
function equipmentCode(facts: MovementNoticeFacts): string {
  return (
    clean(facts.equipmentCode)
      .replace(/[^A-Za-z0-9 _-]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, CODE_MAX_LENGTH) || '-'
  )
}

// "CODE (type)", or the code alone when the type is unknown.
function unit(facts: MovementNoticeFacts): string {
  const code = equipmentCode(facts)
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
      // The EXIT form with this unit ready: the last line of the request.
      const exitUrl = movementExitUrl(facts.appBaseUrl, facts.equipmentCode)
      return block(
        where ? [...facts1, `📍 ${where}`] : facts1,
        [
          '🔧 وصلت الورشة، الرجاء تسجيل خروجها من مشروعك.',
          'Arrived at the workshop. Please record its exit from your project.',
          // A short call to action above the link (owner request 2026-10-15).
          exitUrl ? '👇 اضغط الرابط لتسجيل خروج المعدة' : '',
          exitUrl ? 'Tap the link to record its exit' : '',
          exitUrl ? `🔗 ${exitUrl}` : '',
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
