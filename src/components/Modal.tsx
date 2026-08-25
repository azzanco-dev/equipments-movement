import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  inline?: boolean;
  dismissible?: boolean;
}

let modalDepth = 0;
let bodyOverflowBeforeModal = '';

export function Modal({ open, onClose, title, children, size = 'md', inline = false, dismissible = true }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open || inline) return;
    const appShell = document.getElementById('app-shell');
    const previousFocus = document.activeElement as HTMLElement | null;
    if (modalDepth === 0) {
      bodyOverflowBeforeModal = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      appShell?.setAttribute('inert', '');
      appShell?.setAttribute('aria-hidden', 'true');
    }
    modalDepth += 1;
    const modalLevel = modalDepth;
    window.setTimeout(() => dialogRef.current?.querySelector<HTMLElement>('input, button, select, textarea, [tabindex]:not([tabindex="-1"])')?.focus(), 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (dismissible && event.key === 'Escape' && modalDepth === modalLevel) onCloseRef.current();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      modalDepth = Math.max(0, modalDepth - 1);
      if (modalDepth === 0) {
        document.body.style.overflow = bodyOverflowBeforeModal;
        appShell?.removeAttribute('inert');
        appShell?.removeAttribute('aria-hidden');
      }
      previousFocus?.focus();
    };
  }, [dismissible, inline, open]);

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

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in backdrop-blur-sm" style={{ background: 'var(--overlay)' }}>
      <div
        className="absolute inset-0"
        onClick={dismissible ? onClose : undefined}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative w-full ${sizeClass} max-h-[90vh] overflow-y-auto rounded-2xl border shadow-2xl`}
        style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
      >
        <div
          className="sticky top-0 z-10 flex items-center justify-between border-b px-6 py-4"
          style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
        >
          <h2 className="text-lg font-bold">{title}</h2>
          {dismissible && <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg">
            <X size={20} />
          </button>}
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
