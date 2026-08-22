import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { useI18n } from '@/i18n/I18nContext';
import { Alert } from '@/components/Alert';
import { Camera, Square } from 'lucide-react';

interface QRScannerProps {
  open: boolean;
  onClose: () => void;
  onScan: (decodedText: string) => void;
}

export function QRScanner({ open, onClose, onScan }: QRScannerProps) {
  const { t } = useI18n();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastScanRef = useRef<{ text: string; time: number }>({ text: '', time: 0 });

  useEffect(() => {
    return () => { stopScanner(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) {
      stopScanner();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function startScanner() {
    setError(null);
    try {
      const scanner = new Html5Qrcode('qr-reader');
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText: string) => {
          const now = Date.now();
          if (decodedText === lastScanRef.current.text && now - lastScanRef.current.time < 3000) return;
          lastScanRef.current = { text: decodedText, time: now };
          onScan(decodedText);
        },
        () => {}
      );
      setScanning(true);
    } catch {
      setError(t('error'));
      setScanning(false);
    }
  }

  async function stopScanner() {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch { /* ignore */ }
      scannerRef.current = null;
    }
    setScanning(false);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 animate-fade-in" style={{ background: 'var(--overlay)' }}>
      <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border shadow-2xl" style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b px-6 py-4" style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}>
          <h2 className="text-lg font-bold">{t('scanQR')}</h2>
          <button onClick={() => { stopScanner(); onClose(); }} className="btn-ghost p-1.5 rounded-lg text-xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-3">
          <div id="qr-reader" className="w-full rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 min-h-[200px] flex items-center justify-center">
            {!scanning && (
              <div className="flex flex-col items-center gap-2 py-12 text-muted">
                <Camera size={40} />
              </div>
            )}
          </div>
          {error && <Alert type="error">{error}</Alert>}
          {scanning ? (
            <button onClick={() => { stopScanner(); onClose(); }} className="btn-outline w-full">
              <Square size={18} /> {t('close')}
            </button>
          ) : (
            <button onClick={startScanner} className="btn-primary w-full">
              <Camera size={18} /> {t('scanQR')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
