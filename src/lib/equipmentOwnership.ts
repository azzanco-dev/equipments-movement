import type { OwnershipStatus } from '@/lib/types';

export function usesExternalSupplier(status: OwnershipStatus): boolean {
  return status === 'external_supplier';
}

export function isOwnedEquipment(status: OwnershipStatus): boolean {
  return status === 'alazani';
}

export function inferOwnershipFromCode(code: string): OwnershipStatus | null {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return 'external_supplier';
  if (normalized.startsWith('TK')) return 'takween';
  if (normalized.startsWith('A')) return 'alazani';
  if (normalized.startsWith('F')) return 'third_party_f';
  if (normalized.startsWith('B')) return 'third_party_partnership_b';
  return 'external_supplier';
}
