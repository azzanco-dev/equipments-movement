import { useState } from 'react'
import {
  Check,
  ChevronDown,
  Edit2,
  Landmark,
  Search,
  Trash2,
} from 'lucide-react'
import { Badge, IconButton } from '@/components/ui'
import { BankLogo } from '@/components/banks/BankLogo'
import { bankLogoOf } from '@/lib/bankLogos'

/**
 * Owner 2026-11-05: «ابغاك تضيف شعارات البنوك، اول سويها في ui-kit». The
 * banks of the list (migration 0177) with the logos downloaded from their
 * own websites (`public/banks/`), shown where a bank appears: the supplier
 * form's picker, the Settings › «البنوك» table and the supplier details.
 * Sample data only; no screen uses the logos until he approves.
 */
const BANKS = [
  'البنك الاهلي السعودي',
  'مصرف الراجحي',
  'بنك الرياض',
  'البنك السعودي الاول',
  'البنك السعودي الفرنسي',
  'البنك العربي الوطني',
  'بنك البلاد',
  'بنك الجزيرة',
  'مصرف الانماء',
  'البنك السعودي للاستثمار',
  'بنك الخليج الدولي',
  'بنك STC',
  'بنك دال 360',
]

const LINKED: Record<string, number> = {
  'مصرف الراجحي': 14,
  'البنك الاهلي السعودي': 9,
  'بنك الرياض': 6,
  'مصرف الانماء': 4,
  'بنك البلاد': 2,
}

function Panel({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
}

export function BankLogosMockup() {
  const [picked, setPicked] = useState('مصرف الانماء')
  const [open, setOpen] = useState(true)
  const withLogo = BANKS.filter((name) => bankLogoOf(name)).length

  return (
    <div className="space-y-4" dir="rtl">
      <Panel title={`الشعارات (${withLogo} من ${BANKS.length})`}>
        <p className="text-xs text-muted">
          كل بنوك القائمة لها شعار من موقعها الرسمي. اي بنك تضيفه من الاعدادات
          يظهر باول حرف من اسمه حتى نضيف شعاره، مثل «بنك مثال جديد» في اخر
          القائمة.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[...BANKS, 'بنك مثال جديد'].map((name) => (
            <div
              key={name}
              className="flex flex-col items-center gap-2 rounded-lg border bg-[var(--surface)] p-3 text-center"
            >
              <BankLogo name={name} size="lg" />
              <span className="text-xs">{name}</span>
              {!bankLogoOf(name) && (
                <Badge size="sm" tone="warning">
                  بدون شعار بعد
                </Badge>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="1. اختيار البنك في نموذج المورد">
          <div className="space-y-1.5">
            <span className="label">البنك</span>
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="input flex h-10 items-center gap-2 md:h-9"
            >
              <BankLogo name={picked} size="sm" />
              <span className="flex-1 text-start">{picked}</span>
              <ChevronDown size={16} className="text-muted" />
            </button>
            {open && (
              <div className="overflow-hidden rounded-lg border shadow-sm">
                <div className="flex items-center gap-2 border-b px-3 py-2 text-sm text-muted">
                  <Search size={14} />
                  ابحث عن بنك
                </div>
                <ul className="max-h-72 overflow-y-auto py-1">
                  {BANKS.map((name) => (
                    <li key={name}>
                      <button
                        type="button"
                        onClick={() => {
                          setPicked(name)
                          setOpen(false)
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-start text-sm hover:bg-surface-hover"
                      >
                        <BankLogo name={name} size="sm" />
                        <span className="flex-1">{name}</span>
                        {name === picked && <Check size={14} />}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Panel>

        <Panel title="2. جدول صفحة «البنوك» في الاعدادات">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b text-xs text-muted">
                <th className="py-2 text-start font-medium">اسم البنك</th>
                <th className="py-2 text-start font-medium">
                  الموردون المرتبطون
                </th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {BANKS.slice(0, 6).map((name) => (
                <tr key={name} className="border-b last:border-0">
                  <td className="py-2">
                    <span className="flex items-center gap-2 font-semibold">
                      <BankLogo name={name} size="sm" />
                      {name}
                    </span>
                  </td>
                  <td className="py-2">{LINKED[name] ?? 0}</td>
                  <td className="py-2">
                    <span className="flex justify-end gap-1">
                      <IconButton
                        size="sm"
                        label="تعديل"
                        icon={<Edit2 size={15} />}
                      />
                      <IconButton
                        size="sm"
                        label="حذف"
                        icon={<Trash2 size={15} />}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <Panel title="3. قسم البنك في تفاصيل المورد">
        <div className="max-w-xl rounded-xl border bg-[var(--surface)] p-4">
          <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Landmark size={16} className="text-muted" />
            بيانات البنك
          </h4>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <div>
              <div className="text-xs text-muted">البنك</div>
              <div className="mt-1 flex items-center gap-2 text-sm font-medium">
                <BankLogo name={picked} size="md" />
                {picked}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">الايبان (IBAN)</div>
              <div className="mt-1 text-sm font-medium">
                <bdi dir="ltr">SA03 8000 0000 6080 1016 7519</bdi>
              </div>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  )
}
