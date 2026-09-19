/**
 * Minimal `{ value, label }` shape shared by the legacy `components/Select`,
 * `AsyncSearchSelect` and `AsyncMultiSelect`. Lives here (instead of inside
 * `components/Select.tsx`) so the async components have no dependency on the
 * legacy select; `components/Select.tsx` re-exports it for its existing
 * importers.
 */
export interface SelectOption {
  value: string
  label: string
}
