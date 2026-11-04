import { supabase } from '@/lib/supabase'
import type { TakenPartyNumbers } from '@/lib/partyImport'

/**
 * The tax numbers and CRs of a file that a stored supplier or client
 * already carries (EM-260, 0175), read for the import's duplicate check:
 * two bounded `in` reads on the partial unique indexes, never the whole
 * table. Throws on a failed read so the dialog shows its import error.
 */
export async function fetchTakenPartyNumbers(
  table: 'lessors' | 'companies',
  numbers: { tax_number: string[]; commercial_register: string[] },
): Promise<TakenPartyNumbers> {
  const taken: TakenPartyNumbers = {
    tax_number: new Set(),
    commercial_register: new Set(),
  }
  for (const field of ['tax_number', 'commercial_register'] as const) {
    const values = numbers[field]
    // PostgREST URLs stay short: 100 values per read.
    for (let i = 0; i < values.length; i += 100) {
      const { data, error } = await supabase
        .from(table)
        .select(field)
        .in(field, values.slice(i, i + 100))
      if (error) throw error
      for (const row of (data ?? []) as Record<string, string | null>[]) {
        const value = row[field]
        if (value) taken[field].add(value)
      }
    }
  }
  return taken
}
