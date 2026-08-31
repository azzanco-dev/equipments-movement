import { type ReactNode } from 'react'
import { AlertCircle, CheckCircle, Info, AlertTriangle } from 'lucide-react'

interface AlertProps {
  type: 'error' | 'success' | 'info' | 'warning'
  children: ReactNode
}

export function Alert({ type, children }: AlertProps) {
  const icons = {
    error: <AlertCircle size={18} />,
    success: <CheckCircle size={18} />,
    info: <Info size={18} />,
    warning: <AlertTriangle size={18} />,
  }

  return (
    <div
      className={`flex items-start gap-2.5 rounded-lg border p-3.5 text-sm font-medium animate-fade-in ${
        type === 'error'
          ? 'border-red-500 bg-red-50 text-red-800 shadow-sm dark:border-red-700 dark:bg-red-950/40 dark:text-red-200'
          : type === 'warning'
            ? 'border-amber-300 bg-amber-50/80 text-amber-900 shadow-sm dark:border-amber-700/70 dark:bg-amber-950/30 dark:text-amber-200'
            : type === 'success'
              ? 'border-green-300 bg-green-50/80 text-green-800 shadow-sm dark:border-green-800 dark:bg-green-950/30 dark:text-green-200'
            : ''
      }`}
      style={{
        borderColor:
          type === 'error' || type === 'warning' || type === 'success'
            ? undefined
            : 'var(--border)',
        background:
          type === 'error' || type === 'warning' || type === 'success'
            ? undefined
            : 'var(--surface)',
      }}
    >
      <span className="mt-0.5 shrink-0">{icons[type]}</span>
      <div className="flex-1">{children}</div>
    </div>
  )
}
