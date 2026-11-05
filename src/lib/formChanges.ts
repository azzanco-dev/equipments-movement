/**
 * The fields a form changed since it opened (owner 2026-11-05, «لما يضاف
 * تعديل جديد في احد الحقول, عطني شي يعلمني … ممكن يكون تنبيه عام, او في زر
 * الحفظ»): text values are compared trimmed, so typing a space and deleting
 * it again is not a change. First used by the supplier form.
 */
export function changedFields<T extends object>(
  initial: T,
  current: T,
): (keyof T)[] {
  const before = initial as Record<string, unknown>
  const after = current as Record<string, unknown>
  const same = (a: unknown, b: unknown) =>
    typeof a === 'string' && typeof b === 'string'
      ? a.trim() === b.trim()
      : a === b
  return (Object.keys(after) as (keyof T & string)[]).filter(
    (key) => !same(before[key], after[key]),
  )
}
