import { ChevronLeft, ChevronRight } from 'lucide-react';

export function DataListPagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <div className="flex items-center justify-between text-sm"><span className="text-muted">{total} نتيجة</span><div className="flex items-center gap-2"><button className="btn-outline px-3" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronRight size={16} /></button><span>{page} / {pages}</span><button className="btn-outline px-3" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronLeft size={16} /></button></div></div>;
}
