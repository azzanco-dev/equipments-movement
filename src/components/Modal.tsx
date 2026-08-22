import { type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  inline?: boolean;
}

export function Modal({ open, onClose, title, children, size = 'md', inline = false }: ModalProps) {
  if (!open) return null;

  const sizeClass = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  }[size];

  if (inline) return <section className={`mx-auto w-full ${sizeClass} space-y-4`}>
    <div className="flex items-center justify-between"><h1 className="text-2xl font-bold">{title}</h1><button onClick={onClose} className="btn-ghost p-1.5 rounded-lg"><X size={20} /></button></div>
    <div className="card">{children}</div>
  </section>;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in" style={{ background: 'var(--overlay)' }}>
      <div
        className="absolute inset-0"
        onClick={onClose}
      />
      <div
        className={`relative w-full ${sizeClass} max-h-[90vh] overflow-y-auto rounded-2xl border shadow-2xl`}
        style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
      >
        <div
          className="sticky top-0 z-10 flex items-center justify-between border-b px-6 py-4"
          style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
        >
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg">
            <X size={20} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
