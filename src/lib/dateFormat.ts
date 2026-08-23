function dateParts(value: string | Date): { day: number; month: number; year: number; date: Date } | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return { day: value.getDate(), month: value.getMonth() + 1, year: value.getFullYear(), date: value };
  }

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const date = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    return { day: Number(dateOnly[3]), month: Number(dateOnly[2]), year: Number(dateOnly[1]), date };
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return { day: date.getDate(), month: date.getMonth() + 1, year: date.getFullYear(), date };
}

export function formatDate(value: string | Date): string {
  const parts = dateParts(value);
  if (!parts) return typeof value === 'string' ? value : '';
  return `${String(parts.day).padStart(2, '0')}/${String(parts.month).padStart(2, '0')}/${parts.year}`;
}

export function formatDateTime(value: string | Date): string {
  const parts = dateParts(value);
  if (!parts) return typeof value === 'string' ? value : '';
  const time = parts.date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${formatDate(parts.date)} ${time}`;
}
