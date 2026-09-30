// Maps the stable tokens raised by `request_workshop_arrival_notice`
// (migration 0110) onto the safe codes of `POST /api/notifications/workshop-arrival`.
// PostgREST appends the PostgreSQL HINT to `error.message`, so substring
// matching is used. Raw PostgreSQL text never reaches the client.

export const NOTICE_REQUEST_ERROR_CODES = [
  'not_on_site',
  'recently_sent',
  'forbidden',
  'invalid',
  'failed',
] as const

export type NoticeRequestErrorCode = (typeof NOTICE_REQUEST_ERROR_CODES)[number]

export function noticeRequestErrorCode(
  message: string | null | undefined,
): NoticeRequestErrorCode {
  if (!message) return 'failed'
  if (message.includes('equipment_not_on_site')) return 'not_on_site'
  if (message.includes('notice_recently_sent')) return 'recently_sent'
  if (message.includes('notice_role_required')) return 'forbidden'
  if (
    message.includes('equipment_not_found') ||
    message.includes('invalid input syntax for type uuid')
  )
    return 'invalid'
  return 'failed'
}

// The unit is not inside a site: a state conflict (409). A repeat within the
// 10-minute window: too many requests (429). Anything unknown is a 500.
export function noticeRequestErrorStatus(code: NoticeRequestErrorCode): number {
  if (code === 'not_on_site') return 409
  if (code === 'recently_sent') return 429
  if (code === 'forbidden') return 403
  if (code === 'invalid') return 400
  return 500
}
