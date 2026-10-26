import { splitPlateForDisplay } from '@/lib/plate'

/**
 * The plate as «1128 XVV» (the digits, then the letters spaced by
 * letter-spacing, never by spaces — owner 2026-10-25), a plate in another
 * form as stored, else the chassis number; an isolated left-to-right run.
 */
export function InquiryPlate({
  plate,
  chassis,
}: {
  plate: string | null
  chassis: string | null
}) {
  const parts = plate ? splitPlateForDisplay(plate) : null
  const value = parts ? null : plate?.trim() || chassis?.trim() || null
  if (!parts && !value) return <>—</>
  return (
    <bdi dir="ltr" className="whitespace-nowrap">
      {parts ? (
        <>
          {parts.digits}{' '}
          <span className="-me-[0.15em] tracking-[0.15em]">{parts.letters}</span>
        </>
      ) : (
        value
      )}
    </bdi>
  )
}
