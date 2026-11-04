import { splitPlateForDisplay } from '@/lib/plate'

/** The plate's digits, then its letters spaced by letter-spacing (as on
 *  the purchasing lists); the chassis as it is; nothing without either. */
export function PlateOrChassis({
  plate,
  chassis,
}: {
  plate: string | null
  chassis: string | null
}) {
  const parts = plate ? splitPlateForDisplay(plate) : null
  const text = plate?.trim() || chassis?.trim()
  if (!parts)
    return text ? (
      <span dir="ltr" className="text-xs text-muted">
        {text}
      </span>
    ) : null
  return (
    <span dir="ltr" className="text-xs text-muted">
      {parts.digits}{' '}
      <span className="-me-[0.15em] tracking-[0.15em]">{parts.letters}</span>
    </span>
  )
}

/**
 * The identity cell of the sales lists (the purchasing lists' look): the
 * bold code with the plate («1128 XVV») or the chassis beside it, the type
 * under them. Shared by «حسب المعدات», the batch screen and «الشهور».
 */
export function UnitIdentityCell({
  code,
  type,
  plate,
  chassis,
}: {
  code: string | null
  type: string | null
  plate: string | null
  chassis: string | null
}) {
  return (
    <span className="flex flex-col text-start">
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <span dir="ltr" className="font-semibold">
          {code ?? '—'}
        </span>
        <PlateOrChassis plate={plate} chassis={chassis} />
      </span>
      {type && (
        <span className="truncate-safe max-w-[12rem] text-xs text-muted">
          {type}
        </span>
      )}
    </span>
  )
}
