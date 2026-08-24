import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n } from '@/i18n/I18nContext';

export function DataListPagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const { t, dir } = useI18n();
  return <div className="flex items-center justify-between text-sm"><span className="text-muted">{t('resultsCount').replace('{count}', String(total))}</span><div className="flex items-center gap-2"><button className="btn-outline px-3" disabled={page <= 1} onClick={() => onPage(page - 1)}>{dir === 'rtl' ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}</button><span>{page} / {pages}</span><button className="btn-outline px-3" disabled={page >= pages} onClick={() => onPage(page + 1)}>{dir === 'rtl' ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}</button></div></div>;
}
