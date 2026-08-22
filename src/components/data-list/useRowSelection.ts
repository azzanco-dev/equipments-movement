import { useState } from 'react';

export function useRowSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const togglePage = (ids: string[]) => setSelected((current) => ids.every((id) => current.has(id)) ? new Set([...current].filter((id) => !ids.includes(id))) : new Set([...current, ...ids]));
  return { selected, toggle, togglePage, clear: () => setSelected(new Set<string>()) };
}
