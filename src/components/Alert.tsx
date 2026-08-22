import { type ReactNode } from 'react';
import { AlertCircle, CheckCircle, Info, AlertTriangle } from 'lucide-react';

interface AlertProps {
  type: 'error' | 'success' | 'info' | 'warning';
  children: ReactNode;
}

export function Alert({ type, children }: AlertProps) {
  const icons = {
    error: <AlertCircle size={18} />,
    success: <CheckCircle size={18} />,
    info: <Info size={18} />,
    warning: <AlertTriangle size={18} />,
  };

  return (
    <div
      className="flex items-start gap-2.5 rounded-lg border p-3.5 text-sm animate-fade-in"
      style={{
        borderColor: type === 'error' ? 'var(--fg)' : 'var(--border)',
        background: type === 'error' ? 'var(--surface)' : 'var(--surface)',
      }}
    >
      <span className="mt-0.5 shrink-0">{icons[type]}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}
