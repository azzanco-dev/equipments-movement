import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/i18n/I18nContext';
import { Modal } from '@/components/Modal';
import { Alert } from '@/components/Alert';
import { InlineSpinner } from '@/components/Spinner';
import { QRCodeDisplay } from '@/components/QRCodeDisplay';
import { Plus, Edit2, Power, QrCode, Printer, Upload, FileSpreadsheet, Download, CheckCircle2, AlertTriangle, XCircle, ChevronRight } from 'lucide-react';
import type { Equipment, Project, Lessor, OperationalStatus, OwnershipStatus, RegistrationType } from '@/lib/types';
import { parseEquipmentExcel, downloadEquipmentTemplate, type EquipmentImportRow } from '@/lib/excel';
import { Select } from '@/components/Select';
import { PageHeader } from '@/components/PageHeader';
import { DatePicker } from '@/components/DatePicker';
import { PlateNumberInput } from '@/components/PlateNumberInput';
import { sanitizeSearchTerm } from '@/lib/search';
import { DataListToolbar } from '@/components/data-list/DataListToolbar';
import { DataListPagination } from '@/components/data-list/DataListPagination';
import { useDataListState } from '@/components/data-list/useDataListState';
import { equipmentListConfig } from '@/lib/listConfigs';
import { applyListFilters } from '@/lib/applyListFilters';
import { inferOwnershipFromCode, usesExternalSupplier } from '@/lib/equipmentOwnership';

function genQrValue(): string {
  return `EQ-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

const emptyForm = {
  code: '', type: '', plate_number: '', operational_status: 'operational' as OperationalStatus,
  ownership_status: 'alazani' as OwnershipStatus, project_id: '', lessor_id: '',
  brand: '', model: '', manufacture_year: '', chassis_number: '', registration_type: '' as string,
  qr_value: '', last_maintenance_date: '', registration_expiry: '', insurance_expiry: '',
};

interface AdminEquipmentProps {
  onSelectEquipment?: (id: string) => void;
}

export function AdminEquipment({ onSelectEquipment }: AdminEquipmentProps = {}) {
  const { t } = useI18n();
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [lessors, setLessors] = useState<Lessor[]>([]);
  const [loading, setLoading] = useState(true);
  const list = useDataListState(equipmentListConfig);
  const [total, setTotal] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Equipment | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [qrModal, setQrModal] = useState<Equipment | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importData, setImportData] = useState<EquipmentImportRow[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [importResult, setImportResult] = useState<{ success: number; fail: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listTopRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const changePage = (nextPage: number) => {
    list.setPage(nextPage);
    window.requestAnimationFrame(() => listTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const fetchEquipment = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('equipment').select('id,code,type,plate_number,operational_status,ownership_status,project_id,lessor_id,brand,model,manufacture_year,chassis_number,registration_type,qr_value,last_maintenance_date,registration_expiry,insurance_expiry,is_active,created_at,updated_at', { count: 'exact' }).order(list.sort, { ascending: list.direction === 'asc' }).range((list.page - 1) * list.pageSize, list.page * list.pageSize - 1);
    const term = sanitizeSearchTerm(list.search);
    if (term) {
      query = query.or(`code.ilike.%${term}%,type.ilike.%${term}%,plate_number.ilike.%${term}%`);
    }
    query = applyListFilters(query, list.filters, new Set(equipmentListConfig.filterFields.map((field) => field.key)));
    const { data, error, count } = await query;
    if (error) console.error(error);
    setEquipment((data as Equipment[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [list.direction, list.filters, list.page, list.pageSize, list.search, list.sort]);

  useEffect(() => {
    supabase.from('projects').select('*').order('name_ar').then(({ data }) => setProjects((data as Project[]) ?? []));
    supabase.from('lessors').select('*').order('name').then(({ data }) => setLessors((data as Lessor[]) ?? []));
  }, []);

  useEffect(() => { fetchEquipment(); }, [fetchEquipment]);

  useEffect(() => {
    function handleEditEvent(e: Event) {
      const eq = (e as CustomEvent).detail as Equipment;
      openEdit(eq);
    }
    window.addEventListener('edit-equipment', handleEditEvent);
    return () => window.removeEventListener('edit-equipment', handleEditEvent);
  }, []);

  function openAdd() {
    setEditing(null);
    setForm({ ...emptyForm, qr_value: genQrValue() });
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(eq: Equipment) {
    setEditing(eq);
    setForm({
      code: eq.code, type: eq.type, plate_number: eq.plate_number ?? '',
      operational_status: eq.operational_status, ownership_status: eq.ownership_status,
      project_id: eq.project_id ?? '', lessor_id: eq.lessor_id ?? '',
      brand: eq.brand ?? '', model: eq.model ?? '', manufacture_year: eq.manufacture_year?.toString() ?? '',
      chassis_number: eq.chassis_number ?? '', registration_type: eq.registration_type ?? '',
      qr_value: eq.qr_value, last_maintenance_date: eq.last_maintenance_date ?? '',
      registration_expiry: eq.registration_expiry ?? '', insurance_expiry: eq.insurance_expiry ?? '',
    });
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSave() {
    setSaving(true); setFormError(null);
    try {
      const payload = {
        code: form.code, type: form.type, plate_number: form.plate_number || null,
        operational_status: form.operational_status, ownership_status: form.ownership_status,
        project_id: form.project_id || null, lessor_id: usesExternalSupplier(form.ownership_status) ? (form.lessor_id || null) : null,
        brand: form.brand || null, model: form.model || null,
        manufacture_year: form.manufacture_year ? parseInt(form.manufacture_year) : null,
        chassis_number: form.chassis_number || null,
        registration_type: (form.registration_type || null) as RegistrationType | null,
        qr_value: form.qr_value,
        last_maintenance_date: form.last_maintenance_date || null,
        registration_expiry: form.registration_expiry || null,
        insurance_expiry: form.insurance_expiry || null,
      };
      if (editing) {
        const { error } = await supabase.from('equipment').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('equipment').insert(payload);
        if (error) throw error;
      }
      setModalOpen(false);
      fetchEquipment();
    } catch (err) {
      console.error(err);
      setFormError(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(eq: Equipment) {
    const { error } = await supabase.from('equipment').update({ is_active: !eq.is_active }).eq('id', eq.id);
    if (error) console.error(error);
    fetchEquipment();
  }

  function printQR(eq: Equipment) {
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<html><head><title>QR - ${eq.code}</title></head><body style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif"><h2>${eq.code}</h2><p>${eq.type}</p><img src="https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(eq.qr_value)}" alt="QR" style="width:256px;height:256px"/><p style="margin-top:8px;font-size:12px;color:#666">${eq.qr_value}</p></body></html>`);
    win.document.close();
    win.print();
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
      const rows = parseEquipmentExcel(buf, t);

      const existingCodes = new Set(equipment.map((e) => e.code.toLowerCase()));
      const seenCodes = new Set<string>();
      for (const row of rows) {
        const lc = row.code.toLowerCase();
        if (existingCodes.has(lc) || seenCodes.has(lc)) {
          row._errors.push(t('duplicateCode'));
        }
        seenCodes.add(lc);
      }

      const projectMap = new Map(projects.flatMap((p) => [[p.name_ar.toLowerCase(), p.id], [p.name_en.toLowerCase(), p.id]]));
      const lessorMap = new Map(lessors.map((l) => [l.name.toLowerCase(), l.id]));
      for (const row of rows) {
        if (row.project_name && !projectMap.has(row.project_name.toLowerCase())) {
          row._errors.push(t('projectNotFound'));
        }
        if (usesExternalSupplier(row.ownership_status) && row.lessor_name && !lessorMap.has(row.lessor_name.toLowerCase())) {
          row._errors.push(t('lessorNotFound'));
        }
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

    const projectMap = new Map(projects.flatMap((p) => [[p.name_ar.toLowerCase(), p.id], [p.name_en.toLowerCase(), p.id]]));
    const lessorMap = new Map(lessors.map((l) => [l.name.toLowerCase(), l.id]));

    const rowsToImport = importData.filter((r) => selectedRows.has(r._rowNumber) && r._errors.length === 0);
    const payload = rowsToImport.map((r) => ({
      code: r.code,
      type: r.type,
      plate_number: r.plate_number,
      operational_status: r.operational_status,
      ownership_status: r.ownership_status,
      project_id: r.project_name ? (projectMap.get(r.project_name.toLowerCase()) ?? null) : null,
      lessor_id: usesExternalSupplier(r.ownership_status) && r.lessor_name ? (lessorMap.get(r.lessor_name.toLowerCase()) ?? null) : null,
      brand: r.brand,
      model: r.model,
      manufacture_year: r.manufacture_year,
      chassis_number: r.chassis_number,
      registration_type: r.registration_type,
      qr_value: `EQ-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      last_maintenance_date: r.last_maintenance_date,
      registration_expiry: r.registration_expiry,
      insurance_expiry: r.insurance_expiry,
    }));

    try {
      let successCount = 0;
      let failCount = 0;
      const batchSize = 50;
      for (let i = 0; i < payload.length; i += batchSize) {
        const batch = payload.slice(i, i + batchSize);
        const { error } = await supabase.from('equipment').insert(batch);
        if (error) {
          failCount += batch.length;
        } else {
          successCount += batch.length;
        }
      }
      setImportResult({ success: successCount, fail: failCount });
      if (successCount > 0) fetchEquipment();
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

  const statusLabel = (s: OperationalStatus) => s === 'operational' ? t('operational') : s === 'maintenance' ? t('maintenance') : t('stopped');
  const ownLabel = (s: OwnershipStatus) => s === 'alazani' ? t('ownershipAlazani') : s === 'takween' ? t('ownershipTakween') : s === 'third_party_f' ? t('ownershipThirdPartyF') : s === 'third_party_partnership_b' ? t('ownershipThirdPartyPartnershipB') : t('ownershipExternalSupplier');
  function updateCode(code: string) {
    const inferred = inferOwnershipFromCode(code);
    setForm((current) => inferred ? {
      ...current,
      code,
      ownership_status: inferred,
      lessor_id: usesExternalSupplier(inferred) ? current.lessor_id : '',
    } : { ...current, code });
  }

  function updateOwnership(status: OwnershipStatus) {
    setForm((current) => ({
      ...current,
      ownership_status: status,
      lessor_id: usesExternalSupplier(status) ? current.lessor_id : '',
    }));
  }

  return (
    <div ref={listTopRef} className="space-y-4 scroll-mt-20">
      <PageHeader title={t('equipmentList')} description={t('equipmentDesc')} />
      <DataListToolbar config={equipmentListConfig} search={list.searchInput} onSearch={list.setSearchInput} sort={list.sort} direction={list.direction} onSort={list.setSort} pageSize={list.pageSize} onPageSize={list.setPageSize} filters={list.filters} onFilters={list.setFilters} actions={<><button onClick={openAdd} className="btn-primary"><Plus size={18} /> {t('addEquipment')}</button><button onClick={() => { resetImport(); setImportModalOpen(true); }} className="btn-outline"><Upload size={18} /> {t('importExcel')}</button></>} />

      {loading ? (
        <InlineSpinner label={t('loading')} />
      ) : equipment.length === 0 ? (
        <div className="card text-center py-12"><p className="text-muted">{t('noEquipment')}</p></div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="compact-table w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                  <th className="table-header text-start px-4 py-3">
                    <span>{t('equipmentCode')}</span>
                  </th>
                  <th className="table-header text-start px-4 py-3">
                    <span>{t('equipmentType')}</span>
                  </th>
                  <th className="table-header text-start px-4 py-3">
                    <span>{t('plateNumber')}</span>
                  </th>
                  <th className="table-header text-start px-4 py-3">
                    <span>{t('operationalStatus')}</span>
                  </th>
                  <th className="table-header text-start px-4 py-3">
                    <span>{t('ownershipStatus')}</span>
                  </th>
                  <th className="table-header text-start px-4 py-3">
                    <span>{t('isActive')}</span>
                  </th>
                  <th className="table-header text-start px-4 py-3">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {equipment.map((eq) => (
                  <tr
                    key={eq.id}
                    className="border-b last:border-0 cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
                    style={{ borderColor: 'var(--border)' }}
                    onClick={() => onSelectEquipment?.(eq.id)}
                  >
                    <td className="px-4 py-3 font-semibold">{eq.code}</td>
                    <td className="px-4 py-3 text-muted">{eq.type}</td>
                    <td className="px-4 py-3 text-muted">{eq.plate_number ?? '—'}</td>
                    <td className="px-4 py-3 text-muted">{statusLabel(eq.operational_status)}</td>
                    <td className="px-4 py-3 text-muted">{ownLabel(eq.ownership_status)}</td>
                    <td className="px-4 py-3">{eq.is_active ? t('active') : t('inactive')}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => openEdit(eq)} className="btn-ghost p-1.5"><Edit2 size={16} /></button>
                        <button onClick={() => setQrModal(eq)} className="btn-ghost p-1.5"><QrCode size={16} /></button>
                        <button onClick={() => toggleActive(eq)} className="btn-ghost p-1.5"><Power size={16} /></button>
                        <ChevronRight size={16} className="text-muted ms-1" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t px-4 py-3" style={{ borderColor: 'var(--border)' }}><DataListPagination page={list.page} pageSize={list.pageSize} total={total} onPage={changePage} /></div>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? t('editEquipment') : t('addEquipment')} size="lg">
        {formError && <div className="mb-4"><Alert type="error">{formError}</Alert></div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label className="label">{t('equipmentCode')} *</label><input className="input" dir="ltr" placeholder={t('equipmentCodePlaceholder')} value={form.code} onChange={(e) => updateCode(e.target.value)} /></div>
          <div><label className="label">{t('equipmentType')} *</label><input className="input" placeholder={t('equipmentTypePlaceholder')} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} /></div>
          <div className="sm:col-span-2">
            <label className="label">{t('plateNumber')}</label>
            <PlateNumberInput
              value={form.plate_number}
              onChange={(value) => setForm({ ...form, plate_number: value })}
            />
          </div>
          <div><label className="label">{t('manufactureYear')}</label><input className="input" type="number" placeholder={t('manufactureYearPlaceholder')} value={form.manufacture_year} onChange={(e) => setForm({ ...form, manufacture_year: e.target.value })} /></div>
          <div><label className="label">{t('brand')}</label><input className="input" placeholder={t('brandPlaceholder')} value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></div>
          <div><label className="label">{t('model')}</label><input className="input" placeholder={t('modelPlaceholder')} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></div>
          <div><label className="label">{t('chassisNumber')}</label><input className="input" dir="ltr" placeholder={t('chassisNumberPlaceholder')} value={form.chassis_number} onChange={(e) => setForm({ ...form, chassis_number: e.target.value })} /></div>
          <div>
            <label className="label">{t('operationalStatus')}</label>
            <Select
              value={form.operational_status}
              onChange={(v) => setForm({ ...form, operational_status: v as OperationalStatus })}
              options={[
                { value: 'operational', label: t('operational') },
                { value: 'maintenance', label: t('maintenance') },
                { value: 'stopped', label: t('stopped') },
              ]}
            />
          </div>
          <div>
            <label className="label">{t('ownershipStatus')}</label>
            <Select
              value={form.ownership_status}
              onChange={(v) => updateOwnership(v as OwnershipStatus)}
              options={[
                { value: 'alazani', label: t('ownershipAlazani') },
                { value: 'takween', label: t('ownershipTakween') },
                { value: 'third_party_f', label: t('ownershipThirdPartyF') },
                { value: 'third_party_partnership_b', label: t('ownershipThirdPartyPartnershipB') },
                { value: 'external_supplier', label: t('ownershipExternalSupplier') },
              ]}
            />
          </div>
          <div>
            <label className="label">{t('registrationType')}</label>
            <Select
              value={form.registration_type}
              onChange={(v) => setForm({ ...form, registration_type: v })}
              placeholder="—"
              options={[
                { value: '', label: '—' },
                { value: 'private_transport', label: t('privateTransport') },
                { value: 'public_transport', label: t('publicTransport') },
                { value: 'heavy_equipment', label: t('heavyEquipment') },
              ]}
            />
          </div>
          <div>
            <label className="label">{t('project')}</label>
            <Select
              value={form.project_id}
              onChange={(v) => setForm({ ...form, project_id: v })}
              placeholder="—"
              searchable

              options={[
                { value: '', label: '—' },
                ...projects.map((p) => ({ value: p.id, label: `${p.name_ar} — ${p.name_en}` })),
              ]}
            />
          </div>
          {usesExternalSupplier(form.ownership_status) && <div>
            <label className="label">{t('externalSupplier')}</label>
            <Select
              value={form.lessor_id}
              onChange={(v) => setForm({ ...form, lessor_id: v })}
              placeholder="—"
              searchable

              options={[
                { value: '', label: '—' },
                ...lessors.map((l) => ({ value: l.id, label: l.name })),
              ]}
            />
          </div>}
          <div><label className="label">{t('lastMaintenanceDate')}</label><DatePicker value={form.last_maintenance_date} onChange={(v) => setForm({ ...form, last_maintenance_date: v })} /></div>
          <div><label className="label">{t('registrationExpiry')}</label><DatePicker value={form.registration_expiry} onChange={(v) => setForm({ ...form, registration_expiry: v })} /></div>
          <div><label className="label">{t('insuranceExpiry')}</label><DatePicker value={form.insurance_expiry} onChange={(v) => setForm({ ...form, insurance_expiry: v })} /></div>
          <div><label className="label">{t('qrValue')} *</label><input className="input" dir="ltr" placeholder={t('qrValuePlaceholder')} value={form.qr_value} onChange={(e) => setForm({ ...form, qr_value: e.target.value })} /></div>
        </div>
        <div className="flex gap-3 pt-4">
          <button onClick={() => setModalOpen(false)} className="btn-outline flex-1">{t('cancel')}</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">{saving ? t('saving') : t('save')}</button>
        </div>
      </Modal>

      <Modal open={!!qrModal} onClose={() => setQrModal(null)} title={t('qrValue')} size="sm">
        {qrModal && (
          <div className="flex flex-col items-center gap-4 py-4">
            <p className="font-bold text-lg">{qrModal.code}</p>
            <p className="text-sm text-muted">{qrModal.type}</p>
            <QRCodeDisplay value={qrModal.qr_value} size={200} />
            <p className="text-xs text-muted break-all text-center">{qrModal.qr_value}</p>
            <button onClick={() => printQR(qrModal)} className="btn-outline"><Printer size={16} /> {t('printQR')}</button>
          </div>
        )}
      </Modal>

      <Modal open={importModalOpen} onClose={() => setImportModalOpen(false)} title={t('importEquipment')} size="xl">
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
              <button onClick={() => downloadEquipmentTemplate(t)} className="btn-ghost text-sm"><Download size={16} /> {t('downloadTemplate')}</button>
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
                <button onClick={() => downloadEquipmentTemplate(t)} className="btn-ghost text-sm"><Download size={16} /> {t('downloadTemplate')}</button>
              </div>
            </div>

            <div className="max-h-[400px] overflow-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                    <th className="px-3 py-2 w-8"></th>
                    <th className="table-header text-start px-3 py-2">{t('row')}</th>
                    <th className="table-header text-start px-3 py-2">{t('equipmentCode')}</th>
                    <th className="table-header text-start px-3 py-2">{t('equipmentType')}</th>
                    <th className="table-header text-start px-3 py-2">{t('plateNumber')}</th>
                    <th className="table-header text-start px-3 py-2">{t('operationalStatus')}</th>
                    <th className="table-header text-start px-3 py-2">{t('ownershipStatus')}</th>
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
                        <td className="px-3 py-2 font-semibold">{row.code || '—'}</td>
                        <td className="px-3 py-2 text-muted">{row.type || '—'}</td>
                        <td className="px-3 py-2 text-muted">{row.plate_number ?? '—'}</td>
                        <td className="px-3 py-2 text-muted">{row.operational_status}</td>
                        <td className="px-3 py-2 text-muted">{row.ownership_status}</td>
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
