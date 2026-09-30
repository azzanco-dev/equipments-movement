/** The first two words of a full name, for the home greeting. Full names are
 * often four parts long and would wrap on a phone. Empty when unusable. */
export function greetingName(fullName: string | null | undefined): string {
  if (typeof fullName !== 'string') return ''
  return fullName.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(' ')
}

/** Splits a greeting template around its `{name}` placeholder so the caller can
 * wrap the name in `<bdi>` (a Latin name inside an Arabic sentence). */
export function greetingParts(
  template: string,
  hasName: boolean,
): { before: string; after: string } | null {
  if (!hasName) return null
  const index = template.indexOf('{name}')
  if (index < 0) return null
  return {
    before: template.slice(0, index),
    after: template.slice(index + '{name}'.length),
  }
}
