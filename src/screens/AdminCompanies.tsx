import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/i18n/I18nContext';
import { Modal } from '@/components/Modal';
import { Alert } from '@/components/Alert';
import { InlineSpinner } from '@/components/Spinner';
import { PageHeader } from '@/components/PageHeader';
import { Plus, Edit2, Trash2, Upload, FileSpreadsheet, Download, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import type { Company } from '@/lib/types';
import { parseCompaniesExcel, downloadCompanyTemplate, type CompanyImportRow } from '@/lib/excel';

export function AdminCompanies() {
  const { t } = useI18n();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Import state
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importData, setImportData] = useState<CompanyImportRow[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [importResult, setImportResult] = useState<{ success: number; fail: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const fetchCompanies = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('companies').select('*').order('name_ar');
    if (error) console.error(error);
    setCompanies((data as Company[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);

  function openAdd() {
    setEditing(null); setNameAr(''); setNameEn(''); setFormError(null); setModalOpen(true);
  }
  function openEdit(c: Company) {
    setEditing(c); setNameAr(c.name_ar); setNameEn(c.name_en); setFormError(null); setModalOpen(true);
  }

  async function handleSave() {
    setSaving(true); setFormError(null);
    try {
      const payload = { name_ar: nameAr, name_en: nameEn };
      if (editing) {
        const { error } = await supabase.from('companies').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('companies').insert(payload);
        if (error) throw error;
      }
      setModalOpen(false); fetchCompanies();
    } catch (err) { console.error(err); setFormError(t('saveFailed')); }
    finally { setSaving(false); }
  }

  async function handleDelete(c: Company) {
    if (!confirm(t('confirmDelete'))) return;
    const { error } = await supabase.from('companies').delete().eq('id', c.id);
    if (error) console.error(error);
    fetchCompanies();
  }

  async function handleFileSelect(file: File) {
    setImportError(null);
    setImportResult(null);
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      setImportError(t('invalidFile'));
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      const rows = parseCompaniesExcel(buf, t);

      const existingAr = new Set(companies.map((c) => c.name_ar.toLowerCase()));
      const existingEn = new Set(companies.map((c) => c.name_en.toLowerCase()));
      const seenAr = new Set<string>();
      const seenEn = new Set<string>();
      for (const row of rows) {
        if (row.name_ar && (existingAr.has(row.name_ar.toLowerCase()) || seenAr.has(row.name_ar.toLowerCase()))) {
          row._errors.push(t('duplicateCompany'));
        }
        if (row.name_en && (existingEn.has(row.name_en.toLowerCase()) || seenEn.has(row.name_en.toLowerCase()))) {
          row._errors.push(t('duplicateCompany'));
        }
        if (row.name_ar) seenAr.add(row.name_ar.toLowerCase());
        if (row.name_en) seenEn.add(row.name_en.toLowerCase());
      }

      setImportData(rows);
      const validIndices = new Set(rows.filter((r) => r._errors.length === 0).map((r) => r._rowNumber));
      setSelectedRows(validIndices);
    } catch {
      setImportError(t('invalidFile'));
    }
  }

  function toggleRow(rowNum: number) {
    const next = new Set(selectedRows);
    if (next.has(rowNum)) next.delete(rowNum);
    else next.add(rowNum);
    setSelectedRows(next);
  }

  function toggleAllValid() {
    const validRows = importData.filter((r) => r._errors.length === 0);
    const allSelected = validRows.every((r) => selectedRows.has(r._rowNumber));
    if (allSelected) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(validRows.map((r) => r._rowNumber)));
    }
  }

  async function handleImport() {
    setImporting(true);
    setImportError(null);

    const rowsToImport = importData.filter((r) => selectedRows.has(r._rowNumber) && r._errors.length === 0);
    const payload = rowsToImport.map((r) => ({
      name_ar: r.name_ar,
      name_en: r.name_en,
    }));

    try {
      let successCount = 0;
      let failCount = 0;
      const batchSize = 50;
      for (let i = 0; i < payload.length; i += batchSize) {
        const batch = payload.slice(i, i + batchSize);
        const { error } = await supabase.from('companies').insert(batch);
        if (error) {
          failCount += batch.length;
        } else {
          successCount += batch.length;
        }
      }
      setImportResult({ success: successCount, fail: failCount });
      if (successCount > 0) fetchCompanies();
    } catch {
      setImportError(t('importError'));
    } finally {
      setImporting(false);
    }
  }

  function resetImport() {
    setImportData([]);
    setSelectedRows(new Set());
    setImportError(null);
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('companies')}
        description={t('companiesDesc')}
        actions={
          <>
            <button onClick={openAdd} className="btn-primary"><Plus size={18} /> {t('addCompany')}</button>
            <button onClick={() => { resetImport(); setImportModalOpen(true); }} className="btn-outline"><Upload size={18} /> {t('importExcel')}</button>
          </>
        }
      />

      {loading ? (
        <InlineSpinner label={t('loading')} />
      ) : companies.length === 0 ? (
        <div className="card text-center py-12"><p className="text-muted">{t('noCompanies')}</p></div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                  <th className="table-header text-start px-4 py-3">{t('companyNameAr')}</th>
                  <th className="table-header text-start px-4 py-3">{t('companyNameEn')}</th>
                  <th className="table-header text-start px-4 py-3">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.id} className="border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-4 py-3 font-semibold">{c.name_ar}</td>
                    <td className="px-4 py-3 text-muted">{c.name_en}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(c)} className="btn-ghost p-1.5"><Edit2 size={16} /></button>
                        <button onClick={() => handleDelete(c)} className="btn-ghost p-1.5"><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? t('editCompany') : t('addCompany')} size="sm">
        {formError && <div className="mb-4"><Alert type="error">{formError}</Alert></div>}
        <div className="space-y-4">
          <div><label className="label">{t('companyNameAr')} *</label><input className="input" value={nameAr} onChange={(e) => setNameAr(e.target.value)} /></div>
          <div><label className="label">{t('companyNameEn')} *</label><input className="input" value={nameEn} onChange={(e) => setNameEn(e.target.value)} /></div>
        </div>
        <div className="flex gap-3 pt-4">
          <button onClick={() => setModalOpen(false)} className="btn-outline flex-1">{t('cancel')}</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">{saving ? t('saving') : t('save')}</button>
        </div>
      </Modal>

      {/* Import Modal */}
      <Modal open={importModalOpen} onClose={() => setImportModalOpen(false)} title={t('importCompanies')} size="xl">
        {importError && <div className="mb-4"><Alert type="error">{importError}</Alert></div>}
        {importResult && (
          <div className="mb-4">
            <Alert type={importResult.fail > 0 ? 'warning' : 'success'}>
              {importResult.fail > 0
                ? t('importPartialSuccess').replace('{success}', String(importResult.success)).replace('{fail}', String(importResult.fail))
                : t('importSuccess').replace('{count}', String(importResult.success))}
            </Alert>
          </div>
        )}

        {importData.length === 0 && !importResult ? (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button onClick={() => downloadCompanyTemplate(t)} className="btn-ghost text-sm"><Download size={16} /> {t('downloadTemplate')}</button>
            </div>
            <div
              className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${dragOver ? 'border-primary bg-primary/5' : 'border-border'}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFileSelect(f); }}
            >
              <FileSpreadsheet size={48} className="mx-auto text-muted mb-4" />
              <p className="text-muted">{t('dragDropFile')}</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
              />
            </div>
          </div>
        ) : importData.length > 0 ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 justify-between">
              <div className="flex gap-4 text-sm">
                <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400"><CheckCircle2 size={16} /> {t('validRows')}: {importData.filter((r) => r._errors.length === 0).length}</span>
                <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400"><AlertTriangle size={16} /> {t('errorRows')}: {importData.filter((r) => r._errors.length > 0).length}</span>
              </div>
              <div className="flex gap-2">
                <button onClick={toggleAllValid} className="btn-ghost text-sm">{selectedRows.size === importData.filter((r) => r._errors.length === 0).length ? t('deselectAll') : t('selectAll')}</button>
                <button onClick={() => downloadCompanyTemplate(t)} className="btn-ghost text-sm"><Download size={16} /> {t('downloadTemplate')}</button>
              </div>
            </div>

            <div className="max-h-[400px] overflow-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                    <th className="px-3 py-2 w-8"></th>
                    <th className="table-header text-start px-3 py-2">{t('row')}</th>
                    <th className="table-header text-start px-3 py-2">{t('companyNameAr')}</th>
                    <th className="table-header text-start px-3 py-2">{t('companyNameEn')}</th>
                    <th className="table-header text-start px-3 py-2">{t('rowErrors')}</th>
                  </tr>
                </thead>
                <tbody>
                  {importData.map((row) => {
                    const hasErrors = row._errors.length > 0;
                    const isSelected = selectedRows.has(row._rowNumber);
                    return (
                      <tr key={row._rowNumber} className={`border-b last:border-0 ${hasErrors ? 'bg-red-50 dark:bg-red-950/20' : ''}`} style={{ borderColor: 'var(--border)' }}>
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            disabled={hasErrors}
                            checked={isSelected}
                            onChange={() => toggleRow(row._rowNumber)}
                            className="rounded"
                          />
                        </td>
                        <td className="px-3 py-2 text-muted">{row._rowNumber}</td>
                        <td className="px-3 py-2 font-semibold">{row.name_ar || '—'}</td>
                        <td className="px-3 py-2 text-muted">{row.name_en || '—'}</td>
                        <td className="px-3 py-2">
                          {hasErrors ? (
                            <div className="flex flex-wrap gap-1">
                              {row._errors.map((err, i) => (
                                <span key={i} className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                                  <XCircle size={12} /> {err}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <CheckCircle2 size={16} className="text-green-600 dark:text-green-400" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={resetImport} className="btn-outline flex-1">{t('cancel')}</button>
              <button onClick={handleImport} disabled={importing || selectedRows.size === 0} className="btn-primary flex-1">
                {importing ? t('importing') : `${t('importSelected')} (${selectedRows.size})`}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 py-8">
            <button onClick={() => { resetImport(); setImportModalOpen(false); }} className="btn-primary">{t('close')}</button>
          </div>
        )}
      </Modal>
    </div>
  );
}
