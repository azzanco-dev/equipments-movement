// Compound Arabic first names are often written with a space («عبد الله»,
// «ابو بكر»); the first word alone would read wrong in a greeting.
const COMPOUND_NAME_PREFIXES = new Set(['عبد', 'ابو', 'أبو'])

/** The first name of a full name, for the home greeting (owner review
 * 2026-10-03). A compound first name keeps its second word. Empty when
 * unusable. */
export function greetingName(fullName: string | null | undefined): string {
  if (typeof fullName !== 'string') return ''
  const words = fullName.trim().split(/\s+/).filter(Boolean)
  if (words.length > 1 && COMPOUND_NAME_PREFIXES.has(words[0]))
    return `${words[0]} ${words[1]}`
  return words[0] ?? ''
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
