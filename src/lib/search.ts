/**
 * Strips characters that are structural in a PostgREST filter string
 * (`,` `.` `(` `)` `:` `"` `\` and `%` / `_` LIKE wildcards) so a search
 * term can never break out of the pattern it is embedded in.
 */
export function sanitizeSearchTerm(raw: string): string {
  return raw
    .trim()
    .replace(/[,.()"\\:*%_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}
