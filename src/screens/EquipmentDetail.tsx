import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/i18n/I18nContext';
import { InlineSpinner } from '@/components/Spinner';
import { QRCodeDisplay } from '@/components/QRCodeDisplay';
import { ArrowLeft, Edit2, Power, Printer, Calendar, Truck, Building2, Wrench, FileText } from 'lucide-react';
import type { Equipment, EntryExitLog, OperationalStatus, OwnershipStatus } from '@/lib/types';
import { PageHeader } from '@/components/PageHeader';

interface EquipmentDetailProps {
  equipmentId: string;
  onBack: () => void;
  onEdit: (eq: Equipment) => void;
  onSelectMovement?: (id: string) => void;
}

export function EquipmentDetail({ equipmentId, onBack, onEdit, onSelectMovement }: EquipmentDetailProps) {
  const { t } = useI18n();
  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [logs, setLogs] = useState<EntryExitLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { data: eqData } = await supabase
      .from('equipment')
      .select('*, project:projects(*), lessor:lessors(*)')
      .eq('id', equipmentId)
      .maybeSingle();
    setEquipment(eqData as Equipment | null);

    const { data: logData } = await supabase
      .from('entry_exit_logs')
      .select('*, supervisor:profiles(*)')
      .eq('equipment_id', equipmentId)
      .order('recorded_at', { ascending: false })
      .limit(50);
    setLogs((logData as EntryExitLog[]) ?? []);
    setLoading(false);
  }, [equipmentId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const statusLabel = (s: OperationalStatus) => s === 'operational' ? t('operational') : s === 'maintenance' ? t('maintenance') : t('stopped');
  const ownLabel = (s: OwnershipStatus) => s === 'alazani' ? t('ownershipAlazani') : s === 'takween' ? t('ownershipTakween') : s === 'third_party_f' ? t('ownershipThirdPartyF') : s === 'third_party_partnership_b' ? t('ownershipThirdPartyPartnershipB') : t('ownershipExternalSupplier');
  const regLabel = (s: string | null) => s === 'private_transport' ? t('privateTransport') : s === 'public_transport' ? t('publicTransport') : s === 'heavy_equipment' ? t('heavyEquipment') : '—';

  const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const formatDateTime = (iso: string) => new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  async function toggleActive(eq: Equipment) {
    const { error } = await supabase.from('equipment').update({ is_active: !eq.is_active }).eq('id', eq.id);
    if (error) console.error(error);
    fetchData();
  }

  function printQR(eq: Equipment) {
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<html><head><title>QR - ${eq.code}</title></head><body style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif"><h2>${eq.code}</h2><p>${eq.type}</p><img src="https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(eq.qr_value)}" alt="QR" style="width:256px;height:256px"/><p style="margin-top:8px;font-size:12px;color:#666">${eq.qr_value}</p></body></html>`);
    win.document.close();
    win.print();
  }

  if (loading) return <InlineSpinner label={t('loading')} />;
  if (!equipment) return (
    <div className="space-y-4">
      <button onClick={onBack} className="btn-ghost"><ArrowLeft size={18} /> {t('backToEquipment')}</button>
      <div className="card text-center py-12"><p className="text-muted">{t('noEquipment')}</p></div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button onClick={onBack} className="btn-ghost"><ArrowLeft size={18} /> {t('backToEquipment')}</button>

      <PageHeader title={t('equipmentDetails')} description={t('equipmentDetailDesc')} />

      {/* Header card */}
      <div className="card">
        <div className="flex flex-col sm:flex-row gap-6">
          {/* QR Code */}
          <div className="flex flex-col items-center gap-3 shrink-0">
            <QRCodeDisplay value={equipment.qr_value} size={160} />
            <div className="flex gap-2">
              <button onClick={() => printQR(equipment)} className="btn-ghost p-2" title={t('printQR')}><Printer size={16} /></button>
              <button onClick={() => onEdit(equipment)} className="btn-ghost p-2" title={t('editEquipment')}><Edit2 size={16} /></button>
              <button onClick={() => toggleActive(equipment)} className="btn-ghost p-2" title={t('isActive')}><Power size={16} /></button>
            </div>
          </div>

          {/* Info */}
          <div className="flex-1 space-y-4">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-2xl font-bold">{equipment.code}</h2>
                <span className={`badge ${equipment.is_active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-800'}`}>
                  {equipment.is_active ? t('active') : t('inactive')}
                </span>
              </div>
              <p className="text-muted mt-1">{equipment.type}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <InfoItem icon={<Truck size={16} />} label={t('plateNumber')} value={equipment.plate_number} />
              <InfoItem icon={<Wrench size={16} />} label={t('operationalStatus')} value={statusLabel(equipment.operational_status)} />
              <InfoItem icon={<Building2 size={16} />} label={t('ownershipStatus')} value={ownLabel(equipment.ownership_status)} />
              <InfoItem label={t('brand')} value={equipment.brand} />
              <InfoItem label={t('model')} value={equipment.model} />
              <InfoItem label={t('manufactureYear')} value={equipment.manufacture_year?.toString()} />
              <InfoItem label={t('chassisNumber')} value={equipment.chassis_number} />
              <InfoItem label={t('registrationType')} value={regLabel(equipment.registration_type)} />
              <InfoItem label={t('project')} value={equipment.project ? `${equipment.project.name_ar} — ${equipment.project.name_en}` : undefined} />
              <InfoItem label={t('lessor')} value={equipment.lessor?.name} />
              <InfoItem icon={<Calendar size={16} />} label={t('lastMaintenanceDate')} value={equipment.last_maintenance_date ? formatDate(equipment.last_maintenance_date) : null} />
              <InfoItem icon={<Calendar size={16} />} label={t('registrationExpiry')} value={equipment.registration_expiry ? formatDate(equipment.registration_expiry) : null} />
              <InfoItem icon={<Calendar size={16} />} label={t('insuranceExpiry')} value={equipment.insurance_expiry ? formatDate(equipment.insurance_expiry) : null} />
            </div>
          </div>
        </div>
      </div>

      {/* Movement history */}
      <div>
        <h3 className="text-lg font-bold mb-3 flex items-center gap-2"><FileText size={18} /> {t('movementHistory')}</h3>
        {logs.length === 0 ? (
          <div className="card text-center py-12"><p className="text-muted">{t('noMovements')}</p></div>
        ) : (
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                    <th className="table-header text-start px-4 py-3">{t('movementType')}</th>
                    <th className="table-header text-start px-4 py-3">{t('supervisorName')}</th>
                    <th className="table-header text-start px-4 py-3">{t('driverName')}</th>
                    <th className="table-header text-start px-4 py-3">{t('recordedAt')}</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr
                      key={log.id}
                      className={`border-b last:border-0 ${onSelectMovement ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors' : ''}`}
                      style={{ borderColor: 'var(--border)' }}
                      onClick={onSelectMovement ? () => onSelectMovement(log.id) : undefined}
                    >
                      <td className="px-4 py-3">
                        <span className="badge border" style={{ borderColor: 'var(--border)' }}>
                          {log.movement_type === 'entry' ? t('entry') : t('exit')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted">{log.supervisor?.full_name ?? '—'}</td>
                      <td className="px-4 py-3">{log.driver_name ?? '—'}</td>
                      <td className="px-4 py-3 text-muted whitespace-nowrap">{formatDateTime(log.recorded_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoItem({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs text-muted mb-1 flex items-center gap-1.5">{icon} {label}</p>
      <p className="font-medium">{value || '—'}</p>
    </div>
  );
}
